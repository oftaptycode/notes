import { openDB, type DBSchema } from 'idb';
import type { Note } from './types';

const DB_NAME = 'notes-db';
interface SyncMetadata {
  id: string;
  revision: string | null;
  dirty: number;
}
interface NotesDB extends DBSchema {
  notes: { key: string; value: Note; indexes: { updatedAt: number } };
  syncMetadata: { key: string; value: SyncMetadata; indexes: { dirty: number } };
}
const metadataFor = (note: Note): SyncMetadata => ({
  id: note.id, revision: note.synced?.serverUpdatedAt ?? null, dirty: note.dirty ? 1 : 0,
});

async function openNewDB() {
  return openDB<NotesDB>(DB_NAME, 2, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        const store = db.createObjectStore('notes', { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      const metadata = db.createObjectStore('syncMetadata', { keyPath: 'id' });
      metadata.createIndex('dirty', 'dirty');
      // Upgrade existing installations without rewriting or discarding notes.
      void (async () => {
        let cursor = await tx.objectStore('notes').openCursor();
        while (cursor) {
          await metadata.put(metadataFor(cursor.value));
          cursor = await cursor.continue();
        }
      })().catch(() => tx.abort());
    },
    blocking(_current, _blocked, event) {
      (event.target as IDBDatabase).close();
      dbPromise = undefined;
    },
  });
}

// Idempotently copy legacy notes. Keep the old database as a recovery backup.
async function migrateLegacy(db: Awaited<ReturnType<typeof openNewDB>>) {
  let legacy: Awaited<ReturnType<typeof openDB>> | undefined;
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    if (!dbs.some((d) => d.name === 'shita-notes')) return;
    legacy = await openDB('shita-notes');
    const rows: Note[] = await legacy.getAll('notes');
    const tx = db.transaction(['notes', 'syncMetadata'], 'readwrite');
    try {
      for (const n of rows) {
        if (!(await tx.objectStore('notes').get(n.id))) {
          await tx.objectStore('notes').put(n);
          await tx.objectStore('syncMetadata').put(metadataFor(n));
        }
      }
      await tx.done;
    } catch (err) {
      try { tx.abort(); } catch { /* Already aborted. */ }
      await tx.done.catch(() => {});
      throw err;
    }
  } catch (err) {
    console.warn('Legacy DB migration failed:', err);
  } finally {
    legacy?.close();
  }
}

let dbPromise: Promise<Awaited<ReturnType<typeof openNewDB>>> | undefined;
function getDB() {
  return dbPromise ??= (async () => {
    try {
      const db = await openNewDB();
      await migrateLegacy(db);
      return db;
    } catch (err) {
      dbPromise = undefined;
      throw err;
    }
  })();
}

export async function getAllNotes(): Promise<Note[]> {
  const db = await getDB();
  const all: Note[] = await db.getAll('notes');
  return all.filter((n) => !n.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNote(id: string): Promise<Note | undefined> {
  const db = await getDB();
  return db.get('notes', id);
}

export async function putNote(note: Note): Promise<void> {
  await updateNotes(note.id, () => [note]);
}

export async function getDirtyNotes(): Promise<Note[]> {
  const db = await getDB();
  const tx = db.transaction(['notes', 'syncMetadata']);
  const ids = await tx.objectStore('syncMetadata').index('dirty').getAllKeys(1);
  const notes = await Promise.all(ids.map(id => tx.objectStore('notes').get(id)));
  await tx.done;
  return notes.filter((note): note is Note => !!note?.dirty);
}

export async function getSyncRevisions(): Promise<Map<string, string | null>> {
  const db = await getDB();
  const metadata = await db.getAll('syncMetadata');
  return new Map(metadata.map(row => [row.id, row.revision]));
}

export async function hasDirtyNotes(): Promise<boolean> {
  const db = await getDB();
  return (await db.countFromIndex('syncMetadata', 'dirty', 1)) > 0;
}

export async function getNotes(ids: readonly string[]): Promise<Note[]> {
  const db = await getDB();
  const tx = db.transaction('notes');
  const notes = await Promise.all(ids.map(id => tx.store.get(id)));
  await tx.done;
  return notes.filter((note): note is Note => !!note);
}

export async function getAllIncludingDeleted(): Promise<Note[]> {
  const db = await getDB();
  return db.getAll('notes');
}

// Read, compare and write in one transaction, including any conflict backups.
// The callback must be synchronous: never hold an IndexedDB transaction over network I/O.
export async function updateNotes(
  id: string,
  update: (current: Note | undefined) => Note[],
): Promise<Note[]> {
  const db = await getDB();
  const tx = db.transaction(['notes', 'syncMetadata'], 'readwrite');
  try {
    const notes = update(await tx.objectStore('notes').get(id));
    for (const note of notes) {
      await tx.objectStore('notes').put(note);
      await tx.objectStore('syncMetadata').put(metadataFor(note));
    }
    await tx.done;
    return notes;
  } catch (err) {
    try { tx.abort(); } catch { /* Already aborted. */ }
    await tx.done.catch(() => {});
    throw err;
  }
}
