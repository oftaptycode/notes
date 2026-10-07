import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { baseline, createBackend, note, resetDatabase, row } from './helpers';

const mocked = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../src/supabase', () => ({ get supabase() { return mocked.client; } }));
let backend: ReturnType<typeof createBackend>;

beforeEach(() => {
  vi.resetModules();
  resetDatabase();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  backend = createBackend();
  mocked.client = backend.client;
});
afterEach(() => vi.useRealTimers());

it('downloads before uploading and preserves both conflicting versions', async () => {
  backend.rows.set('n', row(note('n', 'other device edit')));
  const db = await import('../src/db');
  await db.putNote(note('n', 'my offline edit', { dirty: true }));
  const { sync } = await import('../src/sync');
  await sync();
  expect(backend.events[0]).toBe('read');
  expect(backend.rows.get('n')?.content).toBe('my offline edit');
  expect([...backend.rows.values()].map(r => r.content)).toContain('(conflict copy)\n\nother device edit');
  expect(await db.getDirtyNotes()).toEqual([]);
});

it('does not start a second sync while authentication is pending', async () => {
  let release!: () => void;
  backend.hooks.beforeSession = () => new Promise<void>(resolve => { release = resolve; });
  const { sync } = await import('../src/sync');
  const first = sync();
  await vi.waitFor(() => expect(backend.client.auth.getSession).toHaveBeenCalledTimes(1));
  await sync();
  expect(backend.client.auth.getSession).toHaveBeenCalledTimes(1);
  release();
  await first;
});

it('keeps edits made during an upload dirty until a later sync', async () => {
  const db = await import('../src/db');
  await db.putNote(note('n', 'first edit', { dirty: true }));
  backend.hooks.afterWrite = async () => {
    backend.hooks.afterWrite = undefined;
    await db.updateNotes('n', current => [{ ...current!, content: 'newer edit', dirty: true }]);
  };
  const { sync, onSyncStatus } = await import('../src/sync');
  const status = vi.fn();
  onSyncStatus(status);
  await sync();
  expect(await db.getNote('n')).toMatchObject({ content: 'newer edit', dirty: true });
  expect(status).toHaveBeenLastCalledWith('pending');
  await sync();
  expect(backend.rows.get('n')?.content).toBe('newer edit');
  expect((await db.getNote('n'))?.dirty).toBe(false);
});

it('preserves a racing server edit when a conditional update fails', async () => {
  const original = row(note('n'));
  backend.rows.set('n', original);
  const db = await import('../src/db');
  await db.putNote(note('n', 'my edit', { dirty: true, synced: baseline(original) }));
  backend.hooks.beforeWrite = async () => {
    backend.hooks.beforeWrite = undefined;
    backend.rows.set('n', { ...original, content: 'racing remote edit', server_updated_at: '2026-10-06T01:00:00.000Z' });
  };
  const { sync } = await import('../src/sync');
  await sync();
  expect(backend.rows.get('n')?.content).toBe('my edit');
  expect((await db.getAllNotes()).map(n => n.content)).toContain('(conflict copy)\n\nracing remote edit');
});

it('downloads all pages even with tied timestamps and a smaller server cap', async () => {
  backend.cap = 2;
  for (const id of ['a', 'b', 'c', 'd', 'e']) backend.rows.set(id, row(note(id, id)));
  localStorage.setItem('notes-sync-cursor', '2099-01-01T00:00:00.000Z');
  const { sync } = await import('../src/sync');
  await sync();
  const db = await import('../src/db');
  expect((await db.getAllNotes()).map(n => n.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
});

it('checks only revisions on an unchanged sync, without note writes or UI refreshes', async () => {
  backend.rows.set('n', row(note('n')));
  const { sync, onAfterMerge } = await import('../src/sync');
  const merged = vi.fn();
  onAfterMerge(merged);
  await sync();
  backend.reads.length = 0;
  merged.mockClear();
  const db = await import('../src/db');
  const writes = vi.spyOn(db, 'updateNotes');
  await sync();
  expect(backend.reads.every(read => read.columns === 'id,server_updated_at')).toBe(true);
  expect(writes).not.toHaveBeenCalled();
  expect(merged).not.toHaveBeenCalled();
});

it('fetches only changed/new bodies, including tombstones, with capped body responses', async () => {
  backend.cap = 2;
  for (const id of ['a', 'b', 'c', 'd', 'e']) backend.rows.set(id, row(note(id, id)));
  const { sync } = await import('../src/sync');
  await sync();
  backend.reads.length = 0;
  const revision = '2026-10-07T00:00:00Z'; // Tied server revisions are fine.
  backend.rows.set('a', { ...backend.rows.get('a')!, content: 'changed', server_updated_at: revision });
  backend.rows.set('b', { ...backend.rows.get('b')!, deleted: true, server_updated_at: revision });
  backend.rows.set('f', { ...row(note('f', 'new')), server_updated_at: revision });
  await sync();
  const bodies = backend.reads.filter(read => read.columns === '*').flatMap(read => read.ids);
  expect(bodies.sort()).toEqual(['a', 'b', 'f']);
  const db = await import('../src/db');
  expect(await db.getNote('a')).toMatchObject({ content: 'changed' });
  expect(await db.getNote('b')).toMatchObject({ deleted: true });
  expect((await db.getAllNotes()).map(n => n.id).sort()).toEqual(['a', 'c', 'd', 'e', 'f']);
});

it('merges the latest body when a server write races the revision-only check', async () => {
  backend.rows.set('n', row(note('n', 'first')));
  backend.hooks.afterRead = async () => {
    backend.hooks.afterRead = undefined;
    backend.rows.set('n', { ...backend.rows.get('n')!, content: 'latest', server_updated_at: '2026-10-07T00:00:00Z' });
  };
  const { sync } = await import('../src/sync');
  await sync();
  const db = await import('../src/db');
  expect(await db.getNote('n')).toMatchObject({ content: 'latest', dirty: false });
});

it('uploads independent IDs with a bounded four-request concurrency', async () => {
  const db = await import('../src/db');
  for (let i = 0; i < 6; i++) await db.putNote(note(String(i), String(i), { dirty: true }));
  const releases: (() => void)[] = [];
  let active = 0, maxActive = 0;
  backend.hooks.beforeWrite = () => new Promise<void>(resolve => {
    maxActive = Math.max(maxActive, ++active);
    releases.push(() => { active--; resolve(); });
  });
  const { sync } = await import('../src/sync');
  const result = sync();
  await vi.waitFor(() => expect(releases).toHaveLength(4));
  for (const release of releases.slice()) release();
  await vi.waitFor(() => expect(releases).toHaveLength(6));
  for (const release of releases.slice(4)) release();
  await result;
  expect(maxActive).toBe(4);
  expect(await db.hasDirtyNotes()).toBe(false);
});

it('reports committed merges even if a subsequent body request fails', async () => {
  backend.rows.set('n', row(note('n')));
  backend.hooks.afterRead = async () => {
    if (backend.reads.at(-1)?.columns === '*') backend.failReads = true;
  };
  const { sync, onAfterMerge } = await import('../src/sync');
  const merged = vi.fn();
  onAfterMerge(merged);
  await sync();
  expect(merged).toHaveBeenCalledWith(['n']);
  const db = await import('../src/db');
  expect(await db.getNote('n')).toMatchObject({ content: 'original' });
});

it('settles successful concurrent uploads before releasing the sync lock after a failure', async () => {
  const db = await import('../src/db');
  await db.putNote(note('a', 'fails', { dirty: true }));
  await db.putNote(note('b', 'succeeds', { dirty: true }));
  let writes = 0;
  let release: (() => void) | undefined;
  backend.hooks.beforeWrite = async () => {
    if (++writes === 1) throw new Error('one upload failed');
    await new Promise<void>(resolve => { release = resolve; });
  };
  const { sync, onAfterMerge } = await import('../src/sync');
  const merged = vi.fn();
  onAfterMerge(merged);
  const first = sync();
  await vi.waitFor(() => expect(release).toBeDefined());
  await sync();
  expect(backend.client.auth.getSession).toHaveBeenCalledOnce();
  release!();
  await first;
  expect((await db.getDirtyNotes()).map(n => n.id)).toEqual(['a']);
  expect(merged).toHaveBeenCalledWith(['b']);
  backend.hooks.beforeWrite = undefined;
  await sync();
  expect(await db.hasDirtyNotes()).toBe(false);
});
