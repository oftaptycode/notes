import { getAllNotes, getNote, putNote } from './db';
import { createEditor } from './editor';
import { createList } from './list';
import { newId, type Note } from './types';
import { EditorView } from '@codemirror/view';

const LAST_NOTE_KEY = 'shita-last-note';

const appEl = document.getElementById('app')!;
const searchInput = document.getElementById('search') as HTMLInputElement;
const newBtn = document.getElementById('new-note') as HTMLButtonElement;
const backBtn = document.getElementById('back') as HTMLButtonElement;
const deleteBtn = document.getElementById('delete-note') as HTMLButtonElement;
const saveState = document.getElementById('save-state')!;

let notes: Note[] = [];
let currentId: string | null = null;
let saveTimer: number | null = null;

const editor = createEditor(document.getElementById('editor')!);
const list = createList(
  document.getElementById('list-scroll')!,
  document.getElementById('list-spacer')!,
  document.getElementById('list-rows')!,
  (id) => void openNote(id),
);

async function refreshNotes() {
  notes = await getAllNotes();
  list.setItems(notes);
}

function markDirtyAndSchedule() {
  saveState.textContent = 'Editing…';
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), 500);
}

async function saveNow() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!currentId) return;
  const note = notes.find((n) => n.id === currentId);
  if (!note) return;
  note.content = editor.getContent();
  note.updatedAt = Date.now();
  note.dirty = true;
  await putNote(note);
  list.refreshRow(note.id);
  saveState.textContent = 'Saved';
}

async function openNote(id: string) {
  if (currentId && saveTimer !== null) await saveNow();
  const note = (await getNote(id)) ?? notes.find((n) => n.id === id);
  if (!note || note.deleted) return;
  currentId = id;
  localStorage.setItem(LAST_NOTE_KEY, id);
  editor.setContent(note.content);
  list.setActive(id);
  document.body.classList.add('note-open');
  saveState.textContent = '';
  editor.view.focus();
}

async function createNote() {
  const note: Note = {
    id: newId(),
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    dirty: true,
  };
  await putNote(note);
  notes.unshift(note);
  list.setItems(notes);
  await openNote(note.id);
  saveState.textContent = '';
  editor.view.focus();
}

async function deleteCurrent() {
  if (!currentId) return;
  const note = notes.find((n) => n.id === currentId);
  if (!note) return;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  note.deleted = true;
  note.dirty = true;
  note.updatedAt = Date.now();
  note.content = editor.getContent();
  await putNote(note);
  notes = notes.filter((n) => n.id !== note.id);
  list.setItems(notes);
  currentId = null;
  localStorage.removeItem(LAST_NOTE_KEY);
  editor.setContent('');
  list.setActive(null);
  document.body.classList.remove('note-open');
}

editor.onDocChange(markDirtyAndSchedule);

searchInput.addEventListener('input', () => list.setQuery(searchInput.value));
newBtn.addEventListener('click', () => void createNote());
deleteBtn.addEventListener('click', () => void deleteCurrent());
backBtn.addEventListener('click', () => {
  void saveNow();
  document.body.classList.remove('note-open');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void saveNow();
});
window.addEventListener('pagehide', () => void saveNow());

// Ask the browser not to evict notes under storage pressure (granted silently when it wants to).
if (navigator.storage?.persist) {
  void navigator.storage.persist();
}

// Keep the cursor line visible above the Android on-screen keyboard.
if (window.visualViewport) {
  const vv = window.visualViewport;
  vv.addEventListener('resize', () => {
    appEl.style.height = vv.height + 'px';
    if (currentId) {
      editor.view.dispatch({
        effects: EditorView.scrollIntoView(editor.view.state.selection.main.head, { y: 'nearest' }),
      });
    }
  });
}

(async function boot() {
  await refreshNotes();
  const last = localStorage.getItem(LAST_NOTE_KEY);
  if (last && notes.some((n) => n.id === last)) {
    await openNote(last);
    // Narrow screens start on the list; keep it that way after restore.
    if (window.matchMedia('(max-width: 799px)').matches) {
      document.body.classList.remove('note-open');
    }
  }
})();
