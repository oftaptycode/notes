import { openDB } from 'idb';
import type { Note } from './types';

const DB_NAME = 'notes-db';

async function openNewDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      const store = db.createObjectStore('notes', { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
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
    const tx = db.transaction('notes', 'readwrite');
    try {
      for (const n of rows) {
        if (!(await tx.store.get(n.id))) await tx.store.put(n);
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
  const db = await getDB();
  await db.put('notes', note);
}

export async function getDirtyNotes(): Promise<Note[]> {
  const db = await getDB();
  const all: Note[] = await db.getAll('notes');
  return all.filter((n) => n.dirty);
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
  const tx = db.transaction('notes', 'readwrite');
  try {
    const notes = update(await tx.store.get(id));
    for (const note of notes) await tx.store.put(note);
    await tx.done;
    return notes;
  } catch (err) {
    try { tx.abort(); } catch { /* Already aborted. */ }
    await tx.done.catch(() => {});
    throw err;
  }
}
