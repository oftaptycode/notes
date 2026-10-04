import { openDB, deleteDB } from 'idb';
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

// One-time migration: copy rows from the old 'shita-notes' database, then delete it.
async function migrateLegacy(db: Awaited<ReturnType<typeof openNewDB>>) {
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    if (!dbs.some((d) => d.name === 'shita-notes')) return;
    const legacy = await openDB('shita-notes', 1);
    const rows: Note[] = await legacy.getAll('notes').catch(() => [] as Note[]);
    for (const n of rows) {
      if (!(await db.get('notes', n.id))) await db.put('notes', n);
    }
    legacy.close();
    await deleteDB('shita-notes');
  } catch (err) {
    console.warn('Legacy DB migration failed:', err);
  }
}

const dbPromise = (async () => {
  const db = await openNewDB();
  await migrateLegacy(db);
  return db;
})();

export async function getAllNotes(): Promise<Note[]> {
  const db = await dbPromise;
  const all: Note[] = await db.getAll('notes');
  return all.filter((n) => !n.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNote(id: string): Promise<Note | undefined> {
  const db = await dbPromise;
  return db.get('notes', id);
}

export async function putNote(note: Note): Promise<void> {
  const db = await dbPromise;
  await db.put('notes', note);
}

export async function getDirtyNotes(): Promise<Note[]> {
  const db = await dbPromise;
  const all: Note[] = await db.getAll('notes');
  return all.filter((n) => n.dirty);
}

export async function getAllIncludingDeleted(): Promise<Note[]> {
  const db = await dbPromise;
  return db.getAll('notes');
}
