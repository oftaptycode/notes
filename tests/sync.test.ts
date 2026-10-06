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
