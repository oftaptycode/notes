import { getDirtyNotes, getNote, getSyncRevisions, hasDirtyNotes, updateNotes } from './db';
import { supabase } from './supabase';
import { conflictCopy, type Note } from './types';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error' | 'disabled' | 'local' | 'pending';

const PAGE_SIZE = 200;
let running = false;
let statusListener: ((s: SyncStatus) => void) | null = null;
let beforeSyncListener: (() => Promise<void>) | null = null;
let afterMergeListener: ((ids: string[]) => void | Promise<void>) | null = null;

export function onSyncStatus(cb: (s: SyncStatus) => void) { statusListener = cb; }
export function onBeforeSync(cb: () => Promise<void>) { beforeSyncListener = cb; }
export function onAfterMerge(cb: (ids: string[]) => void | Promise<void>) { afterMergeListener = cb; }

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

async function mergeRemote(row: RemoteRow, changed: Set<string>) {
  const notes = await updateNotes(row.id, (local) => {
    const synced = syncedState(row);
    // A revision check and write stay in the same transaction, including races
    // with another tab. Unchanged records do not incur a put or a UI refresh.
    if (local?.synced?.serverUpdatedAt === row.server_updated_at) return [];
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
  for (const note of notes) changed.add(note.id);
}

async function readRemote(id: string, userId: string): Promise<RemoteRow | null> {
  const { data, error } = await supabase!.from('notes').select('*')
    .eq('user_id', userId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as RemoteRow | null;
}

async function pushNote(id: string, userId: string, changed: Set<string>) {
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
      const notes = await updateNotes(id, (current) => current ? [{
        ...current,
        synced: syncedState(row),
        // Compare inside the write transaction. Never overwrite an in-flight edit.
        dirty: !sameContent(current, row),
      }] : []);
      for (const note of notes) changed.add(note.id);
      return;
    }

    // Another device wrote after our read, or inserted the same ID. Fetch and
    // preserve its version, then retry against that exact server revision.
    const latest = await readRemote(id, userId);
    if (!latest) throw new Error('A remote note is unavailable; your local changes have been kept.');
    await mergeRemote(latest, changed);
  }
}

export async function sync(): Promise<void> {
  if (!supabase || running) return;
  // Acquire before the first await, including authentication and local saves.
  running = true;
  const changed = new Set<string>();
  const notifyChanges = async () => {
    if (!changed.size) return;
    await afterMergeListener?.([...changed]);
    changed.clear();
  };
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

    // Reconcile revision metadata before pushing, but only download changed
    // bodies. No timestamp watermark: ID pagination retains tombstone discovery
    // and correctness with tied timestamps, response caps and concurrent writes.
    const revisions = await getSyncRevisions();
    let afterId: string | null = null;
    while (true) {
      let query = supabase.from('notes').select('id,server_updated_at').eq('user_id', userId)
        .order('id', { ascending: true }).limit(PAGE_SIZE);
      if (afterId) query = query.gt('id', afterId);
      const { data: rows, error: pullError } = await query;
      if (pullError) throw pullError;
      const page = (rows ?? []) as Pick<RemoteRow, 'id' | 'server_updated_at'>[];
      if (page.length === 0) break;
      const ids = page.filter(row => {
        if (!row.server_updated_at) throw new Error('The server did not return a note revision.');
        return revisions.get(row.id) !== row.server_updated_at;
      }).map(row => row.id);
      if (ids.length) {
        let afterBodyId: string | null = null;
        while (true) {
          let bodyQuery = supabase.from('notes').select('*').eq('user_id', userId)
            .in('id', ids).order('id', { ascending: true }).limit(PAGE_SIZE);
          if (afterBodyId) bodyQuery = bodyQuery.gt('id', afterBodyId);
          const { data: bodies, error: bodyError } = await bodyQuery;
          if (bodyError) throw bodyError;
          const bodyPage = (bodies ?? []) as RemoteRow[];
          if (!bodyPage.length) break;
          for (const row of bodyPage) await mergeRemote(row, changed);
          const lastBodyId: string = bodyPage[bodyPage.length - 1].id;
          if (lastBodyId === afterBodyId) throw new Error('Sync pagination did not advance.');
          afterBodyId = lastBodyId;
        }
      }
      const lastId: string = page[page.length - 1].id;
      if (lastId === afterId) throw new Error('Sync pagination did not advance.');
      afterId = lastId;
      // Continue even for a short page: the server may impose a smaller cap.
    }
    await notifyChanges();

    const dirty = await getDirtyNotes();
    let next = 0;
    // Different IDs can upload independently. Settle all workers even if one
    // fails, so no uploads outlive the single-flight lock or failure refresh.
    const uploads = await Promise.allSettled(Array.from({ length: Math.min(4, dirty.length) }, async () => {
      while (next < dirty.length) await pushNote(dirty[next++].id, userId, changed);
    }));
    const failed = uploads.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    await notifyChanges();
    const pending = await hasDirtyNotes();
    statusListener?.(pending ? 'pending' : 'synced');
    if (pending) syncSoon();
  } catch (err) {
    console.error('sync failed', err);
    statusListener?.('error');
    // Surface merges already committed before a later request failed.
    try { await notifyChanges(); } catch (refreshError) { console.error(refreshError); }
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
