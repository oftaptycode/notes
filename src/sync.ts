import { getAllIncludingDeleted, getDirtyNotes, putNote } from './db';
import { supabase } from './supabase';
import { newId, type Note } from './types';

const CURSOR_KEY = 'notes-sync-cursor';
const EPOCH = '1970-01-01T00:00:00.000Z';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error' | 'disabled' | 'local';

let running = false;
let statusListener: ((s: SyncStatus) => void) | null = null;

export function onSyncStatus(cb: (s: SyncStatus) => void) {
  statusListener = cb;
}

function setStatus(s: SyncStatus) {
  statusListener?.(s);
}

function getCursor(): string {
  return localStorage.getItem(CURSOR_KEY) ?? EPOCH;
}

function setCursor(iso: string) {
  localStorage.setItem(CURSOR_KEY, iso);
}

interface RemoteRow {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  deleted: boolean;
}

function rowToNote(r: RemoteRow): Note {
  return {
    id: r.id,
    content: r.content,
    createdAt: Date.parse(r.created_at),
    updatedAt: Date.parse(r.updated_at),
    deleted: r.deleted,
    dirty: false,
  };
}

export async function sync(): Promise<void> {
  if (!supabase || running) return;
  if (!navigator.onLine) {
    setStatus('offline');
    return;
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    setStatus('local');
    return;
  }

  running = true;
  setStatus('syncing');
  try {
    // 1. Push: upsert every dirty note, then clear its dirty flag.
    const dirty = await getDirtyNotes();
    if (dirty.length > 0) {
      const rows = dirty.map((n) => ({
        id: n.id,
        user_id: userId,
        content: n.content,
        created_at: new Date(n.createdAt).toISOString(),
        updated_at: new Date(n.updatedAt).toISOString(),
        deleted: n.deleted,
      }));
      const { error } = await supabase.from('notes').upsert(rows);
      if (error) throw error;
      for (const n of dirty) {
        await putNote({ ...n, dirty: false });
      }
    }

    // 2. Pull: rows changed on the server since the cursor.
    const cursor = getCursor();
    const { data: remoteRows, error: pullError } = await supabase
      .from('notes')
      .select('*')
      .gt('server_updated_at', cursor)
      .order('server_updated_at', { ascending: true });
    if (pullError) throw pullError;

    const all = await getAllIncludingDeleted();
    const byId = new Map(all.map((n) => [n.id, n]));
    let maxServerUpdatedAt = cursor;
    let changed = false;

    for (const row of (remoteRows ?? []) as RemoteRow[]) {
      if (row.server_updated_at > maxServerUpdatedAt) maxServerUpdatedAt = row.server_updated_at;
      const local = byId.get(row.id);

      if (!local) {
        if (!row.deleted) {
          await putNote(rowToNote(row));
          changed = true;
        }
        continue;
      }

      if (local.dirty) {
        // Possible conflict: edited locally AND changed remotely since last sync.
        const remote = rowToNote(row);
        if (remote.updatedAt !== local.updatedAt || remote.deleted !== local.deleted) {
          const localWins = local.updatedAt >= remote.updatedAt;
          const keep = localWins ? local : remote;
          const other = localWins ? remote : local;
          await putNote({ ...keep, id: local.id, dirty: false });
          await putNote({
            id: newId(),
            content: '(conflict copy)\n\n' + other.content,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deleted: false,
            dirty: true,
          });
          changed = true;
        }
        continue;
      }

      // Not dirty locally: adopt the server version.
      await putNote(rowToNote(row));
      changed = true;
    }

    setCursor(maxServerUpdatedAt);
    setStatus('synced');
    if (changed && afterMergeListener) afterMergeListener();
  } catch (err) {
    console.error('sync failed', err);
    setStatus('error');
  } finally {
    running = false;
  }
}

let afterMergeListener: (() => void) | null = null;
export function onAfterMerge(cb: () => void) {
  afterMergeListener = cb;
}

// Debounced sync after local edits (3s).
let editTimer: number | null = null;
export function syncSoon() {
  if (editTimer !== null) clearTimeout(editTimer);
  editTimer = window.setTimeout(() => void sync(), 3000);
}

// Timer trigger while the app is visible.
setInterval(() => {
  if (document.visibilityState === 'visible') void sync();
}, 30_000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void sync();
});
window.addEventListener('online', () => void sync());
