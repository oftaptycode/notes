import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import type { Note } from '../src/types';

export function resetDatabase() {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
}

export function note(id: string, content = 'original', overrides: Partial<Note> = {}): Note {
  return { id, content, createdAt: 1000, updatedAt: 2000, deleted: false, dirty: false, ...overrides };
}

export interface RemoteRow {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  deleted: boolean;
}

export function row(n: Note): RemoteRow {
  return {
    id: n.id, user_id: 'user', content: n.content, deleted: n.deleted,
    created_at: new Date(n.createdAt).toISOString(),
    updated_at: new Date(n.updatedAt).toISOString(),
    server_updated_at: '2026-10-06T00:00:00.000Z',
  };
}

export function baseline(r: RemoteRow): NonNullable<Note['synced']> {
  return { content: r.content, deleted: r.deleted, serverUpdatedAt: r.server_updated_at };
}

export function createBackend(initial: RemoteRow[] = []) {
  const rows = new Map(initial.map(r => [r.id, structuredClone(r)]));
  const events: string[] = [];
  const hooks: {
    beforeSession?: () => Promise<void>;
    beforeWrite?: () => Promise<void>;
    afterWrite?: (row: RemoteRow) => Promise<void>;
    afterRead?: () => Promise<void>;
  } = {};
  let revision = 0;
  const backend = {
    rows, events, hooks, cap: 1000, failReads: false,
    client: {
      auth: { getSession: vi.fn(async () => {
        await hooks.beforeSession?.();
        return { data: { session: { user: { id: 'user' } } }, error: null };
      }) },
      from: vi.fn(() => query()),
    },
  };
  function query() {
    let action: 'read' | 'insert' | 'update' = 'read';
    let values: Partial<RemoteRow> = {};
    const filters: Array<(r: RemoteRow) => boolean> = [];
    let limit = Infinity;
    let sort: keyof RemoteRow = 'id';
    const q = {
      select: () => q,
      update: (v: Partial<RemoteRow>) => { action = 'update'; values = v; return q; },
      insert: (v: Partial<RemoteRow>) => { action = 'insert'; values = v; return q; },
      eq: (key: keyof RemoteRow, value: string | boolean) => { filters.push(r => r[key] === value); return q; },
      gt: (key: keyof RemoteRow, value: string) => { filters.push(r => String(r[key]) > value); return q; },
      order: (key: keyof RemoteRow) => { sort = key; return q; },
      limit: (n: number) => { limit = n; return q; },
      single: () => execute(true),
      maybeSingle: () => execute(true),
      then: (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) => execute(false).then(resolve, reject),
    };
    async function execute(single: boolean) {
      if (action === 'read') {
        events.push('read');
        if (backend.failReads) return { data: null, error: { code: 'network', message: 'offline' } };
        const result = [...rows.values()].filter(r => filters.every(f => f(r)))
          .sort((a, b) => String(a[sort]).localeCompare(String(b[sort])))
          .slice(0, Math.min(limit, backend.cap)).map(r => structuredClone(r));
        await hooks.afterRead?.();
        return { data: single ? result[0] ?? null : result, error: null };
      }
      events.push(action);
      await hooks.beforeWrite?.();
      if (action === 'insert' && rows.has(values.id!)) return { data: null, error: { code: '23505' } };
      const old = action === 'update'
        ? [...rows.values()].find(r => filters.every(f => f(r)))
        : undefined;
      if (action === 'update' && !old) return { data: null, error: null };
      const saved = {
        ...old, ...values,
        server_updated_at: new Date(Date.UTC(2026, 9, 6) + ++revision * 1000).toISOString(),
      } as RemoteRow;
      rows.set(saved.id, structuredClone(saved));
      await hooks.afterWrite?.(saved);
      return { data: structuredClone(saved), error: null };
    }
    return q;
  }
  return backend;
}
