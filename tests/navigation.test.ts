import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { note, resetDatabase } from './helpers';

const mocked = vi.hoisted(() => {
  const state = { content: '', change: null as (() => void) | null };
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
  onAfterMerge: vi.fn(),
}));

// One main import per check keeps window listeners from previous modules out of
// the simulation; a stale popstate handler would fight this module's own one.
async function bootApp() {
  vi.resetModules();
  resetDatabase();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const html = readFileSync('index.html', 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const db = await import('../src/db');
  await db.putNote(note('n', 'initial'));
  localStorage.setItem('notes-last-note', 'n');
  await import('../src/main');
  await vi.waitFor(() => expect((document.getElementById('new-note') as HTMLButtonElement).disabled).toBe(false));
  return db;
}

it('Android back keeps failed-save text reachable, with its history entry', async () => {
  const db = await bootApp();
  try {
    const write = vi.spyOn(db, 'updateNotes').mockImplementation(() => Promise.reject(new Error('disk full')));
    mocked.state.content = 'unsaved';
    mocked.state.change!();
    await vi.waitFor(() => expect(document.getElementById('save-state')!.textContent).toContain('Save failed'));

    // Hardware back must not hide the editor while the save keeps failing.
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(document.body.classList.contains('note-open')).toBe(true));
    expect((history.state as { note?: string } | null)?.note).toBe('n');

    // Restoring real writes lets the promised retry land, and clears the alert.
    write.mockRestore();
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(async () => expect((await db.getNote('n')).content).toBe('unsaved'));
    expect((document.getElementById('save-state')!.textContent)).toContain('Saved');
  } finally { vi.unstubAllGlobals(); }
});

it('warns before closing while a write is still in flight', async () => {
  const db = await bootApp();
  try {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = vi.spyOn(db, 'updateNotes').mockImplementationOnce(
      (...args: Parameters<typeof db.updateNotes>) => gate.then(() => db.updateNotes(...args)));
    mocked.state.content = 'in flight';
    mocked.state.change!();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));

    // The edit left `pendingEdits` when its write began; only `scheduled`
    // still knows about it, so the close must still be blocked.
    const closing = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(true);

    release();
    await vi.waitFor(async () => expect(await db.getNote('n')).toMatchObject({ content: 'in flight', dirty: true }));
    // Once nothing is queued or in flight, closing no longer needs a warning.
    const safe = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(safe);
    expect(safe.defaultPrevented).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});
