import { getDirtyNotes, getNote, updateNotes } from './db';
import { supabase } from './supabase';
import { conflictCopy, type Note } from './types';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error' | 'disabled' | 'local' | 'pending';

const PAGE_SIZE = 200;
let running = false;
let statusListener: ((s: SyncStatus) => void) | null = null;
let beforeSyncListener: (() => Promise<void>) | null = null;
let afterMergeListener: (() => void | Promise<void>) | null = null;

export function onSyncStatus(cb: (s: SyncStatus) => void) { statusListener = cb; }
export function onBeforeSync(cb: () => Promise<void>) { beforeSyncListener = cb; }
export function onAfterMerge(cb: () => void | Promise<void>) { afterMergeListener = cb; }

interface RemoteRow {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  deleted: boolean;
}

function sameContent(a: { content: string; deleted: boolean }, b: { content: string; deleted: boolean }) {
  return a.content === b.content && a.deleted === b.deleted;
}

function syncedState(row: RemoteRow): NonNullable<Note['synced']> {
  if (!row.server_updated_at) throw new Error('The server did not return a note revision.');
  return { content: row.content, deleted: row.deleted, serverUpdatedAt: row.server_updated_at };
}

function rowToNote(row: RemoteRow): Note {
  return {
    id: row.id,
    content: row.content,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    deleted: row.deleted,
    dirty: false,
    synced: syncedState(row),
  };
}

async function mergeRemote(row: RemoteRow) {
  await updateNotes(row.id, (local) => {
    const synced = syncedState(row);
    if (!local || !local.dirty) return [rowToNote(row)];
    if (sameContent(local, row)) return [{ ...local, synced, dirty: false }];
    if (local.synced && sameContent(local.synced, row)) {
      // Only the local document changed since its acknowledged server state.
      return [{ ...local, synced }];
    }
    // Both versions changed (or an old note has no baseline). Keep the local
    // edit dirty and back up the remote version before attempting to replace it.
    return [{ ...local, synced }, conflictCopy(row.content)];
  });
}

async function readRemote(id: string, userId: string): Promise<RemoteRow | null> {
  const { data, error } = await supabase!.from('notes').select('*')
    .eq('user_id', userId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as RemoteRow | null;
}

async function pushNote(id: string, userId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await getNote(id);
    if (!snapshot?.dirty) return;
    const values = {
      content: snapshot.content,
      created_at: new Date(snapshot.createdAt).toISOString(),
      updated_at: new Date(snapshot.updatedAt).toISOString(),
      deleted: snapshot.deleted,
    };
    const result = snapshot.synced
      ? await supabase!.from('notes').update(values)
        .eq('user_id', userId).eq('id', id)
        .eq('server_updated_at', snapshot.synced.serverUpdatedAt)
        .select('*').maybeSingle()
      : await supabase!.from('notes').insert({ ...values, id, user_id: userId })
        .select('*').single();

    if (result.error && result.error.code !== '23505') throw result.error;
    if (!result.error && result.data) {
      const row = result.data as RemoteRow;
      await updateNotes(id, (current) => current ? [{
        ...current,
        synced: syncedState(row),
        // Compare inside the write transaction. Never overwrite an in-flight edit.
        dirty: !sameContent(current, row),
      }] : []);
      return;
    }

    // Another device wrote after our read, or inserted the same ID. Fetch and
    // preserve its version, then retry against that exact server revision.
    const latest = await readRemote(id, userId);
    if (!latest) throw new Error('A remote note is unavailable; your local changes have been kept.');
    await mergeRemote(latest);
  }
}

export async function sync(): Promise<void> {
  if (!supabase || running) return;
  // Acquire before the first await, including authentication and local saves.
  running = true;
  try {
    if (!navigator.onLine) {
      statusListener?.('offline');
      return;
    }
    await beforeSyncListener?.();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const userId = data.session?.user.id;
    if (!userId) {
      statusListener?.('local');
      return;
    }
    statusListener?.('syncing');

    // Small, single-user app: reconcile all notes before pushing. ID keyset
    // pagination avoids response caps, timestamp ties and stale sync cursors.
    let afterId: string | null = null;
    while (true) {
      let query = supabase.from('notes').select('*').eq('user_id', userId)
        .order('id', { ascending: true }).limit(PAGE_SIZE);
      if (afterId) query = query.gt('id', afterId);
      const { data: rows, error: pullError } = await query;
      if (pullError) throw pullError;
      const page = (rows ?? []) as RemoteRow[];
      if (page.length === 0) break;
      for (const row of page) await mergeRemote(row);
      const lastId: string = page[page.length - 1].id;
      if (lastId === afterId) throw new Error('Sync pagination did not advance.');
      afterId = lastId;
      // Continue even for a short page: the server may impose a smaller cap.
    }
    await afterMergeListener?.();

    for (const note of await getDirtyNotes()) await pushNote(note.id, userId);
    await afterMergeListener?.();
    const pending = (await getDirtyNotes()).length > 0;
    statusListener?.(pending ? 'pending' : 'synced');
    if (pending) syncSoon();
  } catch (err) {
    console.error('sync failed', err);
    statusListener?.('error');
    // Surface merges already committed before a later request failed.
    try { await afterMergeListener?.(); } catch (refreshError) { console.error(refreshError); }
  } finally {
    running = false;
  }
}

let editTimer: number | null = null;
export function syncSoon() {
  if (editTimer !== null) clearTimeout(editTimer);
  editTimer = window.setTimeout(() => {
    editTimer = null;
    void sync();
  }, 3000);
}

setInterval(() => {
  if (document.visibilityState === 'visible') void sync();
}, 30_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void sync();
});
window.addEventListener('online', () => void sync());
window.addEventListener('offline', () => statusListener?.('offline'));
