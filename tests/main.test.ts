import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { note, resetDatabase } from './helpers';

const mocked = vi.hoisted(() => {
  const state = { content: '', change: null as (() => void) | null,
    merge: null as ((ids: string[]) => Promise<void>) | null };
  const editor = {
    view: { focus: vi.fn(), dispatch: vi.fn() },
    getContent: () => state.content,
    setContent: vi.fn((content: string) => { state.content = content; }),
    setEditable: vi.fn(),
    onDocChange: (cb: () => void) => { state.change = cb; },
  };
  const list = { setItems: vi.fn(), upsertItems: vi.fn(), setActive: vi.fn(), setQuery: vi.fn() };
  return { state, editor, list };
});
vi.mock('../src/editor', () => ({ createEditor: () => mocked.editor }));
vi.mock('../src/list', () => ({ createList: () => mocked.list }));
vi.mock('../src/supabase', () => ({ supabase: null }));
vi.mock('../src/mood', () => ({ createMoodController: () => ({
  openNote: vi.fn(), updateContent: vi.fn(), clear: vi.fn(), setUser: vi.fn(),
}) }));
vi.mock('../src/sync', () => ({
  sync: vi.fn(), syncSoon: vi.fn(), onSyncStatus: vi.fn(), onBeforeSync: vi.fn(),
  onAfterMerge: (cb: (ids: string[]) => Promise<void>) => { mocked.state.merge = cb; },
}));

it('persists edits and conflict backups without collection scans or editor resets, and refreshes only merged IDs', async () => {
  vi.resetModules();
  resetDatabase();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const html = readFileSync('index.html', 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const db = await import('../src/db');
  await db.putNote(note('n', 'initial'));
  const scans = vi.spyOn(db, 'getAllNotes');
  const targeted = vi.spyOn(db, 'getNotes');
  localStorage.setItem('notes-last-note', 'n');
  try {
    await import('../src/main');
    await vi.waitFor(() => expect((document.getElementById('new-note') as HTMLButtonElement).disabled).toBe(false));
    mocked.editor.setContent.mockClear();
    for (const text of ['first', 'second', 'latest']) {
      mocked.state.content = text;
      mocked.state.change!();
    }
    await vi.waitFor(() => expect(mocked.list.upsertItems).toHaveBeenCalledTimes(3));
    expect(await db.getNote('n')).toMatchObject({ content: 'latest', dirty: true });
    expect(scans).toHaveBeenCalledOnce();
    expect(mocked.editor.setContent).not.toHaveBeenCalled();

    await db.putNote(note('n', 'other tab'));
    mocked.state.content = 'my continuing edit';
    mocked.state.change!();
    await vi.waitFor(() => expect(mocked.list.upsertItems).toHaveBeenCalledTimes(4));
    expect(mocked.list.upsertItems.mock.calls.at(-1)![0].map((n: { content: string }) => n.content))
      .toContain('(conflict copy)\n\nother tab');
    expect(mocked.editor.setContent).not.toHaveBeenCalled();

    await db.putNote(note('n', 'merged server content'));
    await mocked.state.merge!(['n']);
    expect(targeted).toHaveBeenCalledWith(['n']);
    expect(mocked.state.content).toBe('merged server content');
    expect(scans).toHaveBeenCalledOnce();

    mocked.state.content = '  \n ';
    mocked.state.change!();
    await vi.waitFor(() => expect(document.getElementById('delete-note')!.hasAttribute('disabled')).toBe(true));
    expect(await db.getNote('n')).toMatchObject({ deleted: true, dirty: true });
    expect(scans).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
