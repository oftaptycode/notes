import { openDB } from 'idb';
import type { Note } from './types';

const dbPromise = openDB('shita-notes', 1, {
  upgrade(db) {
    const store = db.createObjectStore('notes', { keyPath: 'id' });
    store.createIndex('updatedAt', 'updatedAt');
  },
});

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
