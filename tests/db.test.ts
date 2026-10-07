import { beforeEach, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { baseline, note, resetDatabase, row } from './helpers';

beforeEach(() => { vi.resetModules(); resetDatabase(); });

it('upgrades v1 notes and derives revision/dirty metadata without losing content or tombstones', async () => {
  const original = note('clean', 'original', { synced: baseline(row(note('clean'))) });
  const deleted = note('deleted', 'kept body', { deleted: true, dirty: true });
  const legacy = await openDB('notes-db', 1, {
    upgrade(db) {
      const store = db.createObjectStore('notes', { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
    },
  });
  await legacy.put('notes', original);
  await legacy.put('notes', deleted);
  legacy.close();
  const db = await import('../src/db');
  expect(await db.getAllIncludingDeleted()).toEqual([original, deleted]);
  expect(await db.getSyncRevisions()).toEqual(new Map([
    ['clean', original.synced!.serverUpdatedAt], ['deleted', null],
  ]));
  expect(await db.getDirtyNotes()).toEqual([deleted]);
  expect(await db.hasDirtyNotes()).toBe(true);
});

it('keeps metadata and conflict backups atomic and queries only dirty note bodies', async () => {
  const db = await import('../src/db');
  await db.putNote(note('clean'));
  await db.putNote(note('dirty', 'changed', { dirty: true }));
  await expect(db.updateNotes('dirty', () => { throw new Error('abort'); })).rejects.toThrow('abort');
  expect((await db.getDirtyNotes()).map(n => n.id)).toEqual(['dirty']);
  await db.updateNotes('dirty', current => [{ ...current!, dirty: false }, note('copy', 'backup', { dirty: true })]);
  expect((await db.getDirtyNotes()).map(n => n.id)).toEqual(['copy']);
  expect(await db.getNotes(['clean', 'copy', 'missing'])).toEqual([note('clean'), note('copy', 'backup', { dirty: true })]);
  await db.updateNotes('copy', current => [{ ...current!, dirty: false }]);
  expect(await db.hasDirtyNotes()).toBe(false);
});
