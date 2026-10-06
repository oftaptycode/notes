import { getAllNotes, getNote, putNote, updateNotes } from './db';
import { createEditor } from './editor';
import { createList } from './list';
import { newId, titleFromContent, type Note } from './types';
import { EditorView } from '@codemirror/view';
import { supabase } from './supabase';
import { sync, syncSoon, onSyncStatus, onBeforeSync, onAfterMerge } from './sync';
import { saveEdit, type Edit } from './save';
import { formatCreatedAt } from './dates';
import type { Session } from '@supabase/supabase-js';

const LAST_NOTE_KEY = 'notes-last-note';

const appEl = document.getElementById('app')!;
const searchInput = document.getElementById('search') as HTMLInputElement;
const newBtn = document.getElementById('new-note') as HTMLButtonElement;
const backBtn = document.getElementById('back') as HTMLButtonElement;
const deleteBtn = document.getElementById('delete-note') as HTMLButtonElement;
const exportBtn = document.getElementById('export-note') as HTMLButtonElement;
const saveState = document.getElementById('save-state')!;
const noteFooter = document.getElementById('note-footer')!;
const noteCreated = document.getElementById('note-created') as HTMLTimeElement;
const deleteDialog = document.getElementById('delete-dialog') as HTMLDialogElement;
const deleteDialogNote = document.getElementById('delete-dialog-note')!;

let notes: Note[] = [];
let currentId: string | null = null;
let editorContent = '';
let writeQueue = Promise.resolve();
const pendingEdits = new Map<string, Edit>();
let navigationVersion = 0;
let refreshVersion = 0;

const editor = createEditor(document.getElementById('editor')!);
editor.setEditable(false);
deleteBtn.disabled = true;
exportBtn.disabled = true;
const list = createList(
  document.getElementById('list-scroll')!,
  document.getElementById('list-spacer')!,
  document.getElementById('list-rows')!,
  (id) => run(() => openNote(id)),
);

async function refreshNotes() {
  const version = ++refreshVersion;
  const next = await getAllNotes();
  if (version !== refreshVersion) return;
  notes = next;
  list.setItems(notes);
  if (!currentId || pendingEdits.has(currentId)) return;
  const current = notes.find((n) => n.id === currentId);
  if (!current) {
    clearCurrent();
  } else {
    showCreationDate(current);
    if (editor.getContent() !== current.content) {
      editorContent = current.content;
      editor.setContent(current.content);
    }
  }
}

function showCreationDate(note: Note) {
  noteCreated.textContent = formatCreatedAt(note.createdAt);
  const date = new Date(note.createdAt);
  noteCreated.dateTime = Number.isFinite(date.getTime()) ? date.toISOString() : '';
  noteFooter.hidden = false;
}

function clearCurrent() {
  if (deleteDialog.open) deleteDialog.close('cancel');
  currentId = null;
  editorContent = '';
  localStorage.removeItem(LAST_NOTE_KEY);
  editor.setContent('');
  editor.setEditable(false);
  deleteBtn.disabled = true;
  exportBtn.disabled = true;
  noteFooter.hidden = true;
  noteCreated.textContent = '';
  noteCreated.removeAttribute('datetime');
  list.setActive(null);
  document.body.classList.remove('note-open');
}

function queueEdit(edit: Edit) {
  pendingEdits.set(edit.id, edit);
  writeQueue = writeQueue.then(async () => {
    try {
      const saved = (await saveEdit(edit)).find((note) => note.id === edit.id);
      if (pendingEdits.get(edit.id) === edit) pendingEdits.delete(edit.id);
      syncSoon();
      if (currentId === edit.id && !pendingEdits.has(edit.id)) {
        saveState.textContent = saved?.deleted ? 'Empty note discarded' : 'Saved';
      }
      await refreshNotes();
    } catch (err) {
      console.error('save failed', err);
      if (currentId === edit.id) saveState.textContent = 'Save failed — keep this note open or copy its text';
    }
  });
}

function saveChangedDocument() {
  if (!currentId) return;
  const content = editor.getContent();
  if (content === editorContent) return;
  const edit = { id: currentId, content, previousContent: editorContent };
  editorContent = content;
  saveState.textContent = 'Saving…';
  // Persist each edit now, including deletion when its content becomes empty.
  queueEdit(edit);
}

async function saveNow(discardEmpty = false): Promise<boolean> {
  let queue: Promise<void>;
  do {
    queue = writeQueue;
    await queue;
  } while (queue !== writeQueue);
  // Retry failed writes once. Keep their text and block navigation on failure.
  for (const edit of pendingEdits.values()) queueEdit(edit);
  do {
    queue = writeQueue;
    await queue;
  } while (queue !== writeQueue);
  // A newly created blank note remains editable until you leave it.
  if (discardEmpty && currentId && pendingEdits.size === 0 && editor.getContent().trim() === '') {
    queueEdit({ id: currentId, content: editor.getContent(), previousContent: editorContent });
    do {
      queue = writeQueue;
      await queue;
    } while (queue !== writeQueue);
  }
  return pendingEdits.size === 0;
}

function showNote(note: Note) {
  if (currentId !== note.id || editor.getContent() !== note.content) {
    editorContent = note.content;
    editor.setContent(note.content);
  }
  currentId = note.id;
  editor.setEditable(true);
  deleteBtn.disabled = false;
  exportBtn.disabled = false;
  showCreationDate(note);
  localStorage.setItem(LAST_NOTE_KEY, note.id);
  list.setActive(note.id);
  document.body.classList.add('note-open');
  // One mobile history entry for the editor, not one for every note opened.
  if (window.matchMedia('(max-width: 799px)').matches) {
    if ((history.state as { note?: string } | null)?.note) {
      history.replaceState({ note: note.id }, '');
    } else {
      history.pushState({ note: note.id }, '');
    }
  }
  saveState.textContent = '';
  editor.view.focus();
}

async function openNote(id: string) {
  const version = ++navigationVersion;
  while (version === navigationVersion) {
    if (!(await saveNow(true)) || version !== navigationVersion) return;
    const note = await getNote(id);
    if (version !== navigationVersion) return;
    // Anything typed while the read was in flight belongs to the old document.
    if (pendingEdits.size > 0) continue;
    if (note && !note.deleted) showNote(note);
    return;
  }
}

async function createNote() {
  const version = ++navigationVersion;
  if (!(await saveNow(true)) || version !== navigationVersion) return;
  const note: Note = {
    id: newId(),
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    dirty: false,
  };
  await putNote(note);
  await refreshNotes();
  if (!(await saveNow(true)) || version !== navigationVersion) return;
  showNote(note);
}

function confirmDeletion(): Promise<boolean> {
  if (deleteDialog.open) return Promise.resolve(false);
  deleteDialogNote.textContent = titleFromContent(editor.getContent());
  deleteDialog.returnValue = 'cancel';
  deleteDialog.showModal();
  return new Promise((resolve) => {
    deleteDialog.addEventListener('close', () => resolve(deleteDialog.returnValue === 'delete'), { once: true });
  });
}

deleteDialog.addEventListener('click', (event) => {
  if (event.target !== deleteDialog) return;
  const rect = deleteDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    deleteDialog.close('cancel');
  }
});

async function deleteCurrent() {
  if (!currentId) return;
  const id = currentId;
  const requestedVersion = navigationVersion;
  if (!(await confirmDeletion()) || currentId !== id || navigationVersion !== requestedVersion) return;
  const version = ++navigationVersion;
  if (!(await saveNow()) || version !== navigationVersion) return;
  await updateNotes(id, (note) => note ? [{
    ...note,
    deleted: true,
    dirty: true,
    updatedAt: Math.max(Date.now(), note.updatedAt + 1),
  }] : []);
  syncSoon();
  if (currentId === id && version === navigationVersion) {
    clearCurrent();
    if ((history.state as { note?: string } | null)?.note) history.back();
  }
  await refreshNotes();
}

editor.onDocChange(saveChangedDocument);

function run(action: () => Promise<unknown>) {
  void action().catch((err) => {
    console.error(err);
    saveState.textContent = 'Could not complete the action — your editor text has been kept';
  });
}

// --- Auth + sync UI ---
const authBtn = document.getElementById('auth-btn') as HTMLButtonElement;
const authForm = document.getElementById('auth-form') as HTMLFormElement;
const authEmail = document.getElementById('auth-email') as HTMLInputElement;
const authPassword = document.getElementById('auth-password') as HTMLInputElement;
const authError = document.getElementById('auth-error')!;
const authUser = document.getElementById('auth-user')!;
const syncDot = document.getElementById('sync-dot')!;
const syncLabel = document.getElementById('sync-label')!;

onSyncStatus((s) => {
  syncDot.dataset.state = s;
  syncLabel.textContent = s === 'local' ? 'local only' : s === 'disabled' ? 'no sync' : s === 'pending' ? 'changes pending' : s;
});
onBeforeSync(async () => {
  if (!(await saveNow())) throw new Error('Sync paused because local changes could not be saved.');
});
onAfterMerge(async () => {
  await writeQueue;
  await refreshNotes();
});

function updateAuthUI(session: Session | null) {
  authUser.textContent = session?.user.email ?? '';
  authBtn.textContent = session ? 'Sign out' : 'Sign in';
  authBtn.disabled = false;
  authForm.hidden = true;
  if (!session && supabase) {
    syncDot.dataset.state = 'local';
    syncLabel.textContent = 'local only';
  }
}

if (supabase) {
  let authVersion = 0;
  authBtn.disabled = true;
  authBtn.textContent = 'Checking…';
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    // An auth event is newer than this initial asynchronous lookup.
    if (authVersion !== 0) return;
    updateAuthUI(data.session);
    if (data.session) void sync();
  }).catch((err) => {
    console.error('session lookup failed', err);
    if (authVersion === 0) {
      authBtn.disabled = false;
      authBtn.textContent = 'Sign in';
    }
    authError.textContent = 'Unable to check sign-in status. Try again.';
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    authVersion++;
    updateAuthUI(session);
    if (session) void sync();
  });

  authBtn.addEventListener('click', () => run(async () => {
    const { data, error } = await supabase!.auth.getSession();
    if (error) throw error;
    if (data.session) {
      const { error: signOutError } = await supabase!.auth.signOut();
      if (signOutError) throw signOutError;
      authPassword.value = '';
      updateAuthUI(null);
    } else {
      authForm.hidden = !authForm.hidden;
    }
  }));

  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    run(async () => {
      authError.textContent = '';
      const { data, error } = await supabase!.auth.signInWithPassword({
        email: authEmail.value.trim(),
        password: authPassword.value,
      });
      if (error) authError.textContent = error.message;
      else updateAuthUI(data.session);
    });
  });

  document.getElementById('auth-signup')!.addEventListener('click', () => run(async () => {
    if (!authForm.reportValidity()) return;
    authError.textContent = '';
    const { error } = await supabase!.auth.signUp({
      email: authEmail.value.trim(),
      password: authPassword.value,
    });
    if (error) authError.textContent = error.message;
    else authError.textContent = 'Account created. If email confirmation is enabled, confirm, then sign in.';
  }));

  document.getElementById('auth-close')!.addEventListener('click', () => {
    authForm.hidden = true;
  });
} else {
  authBtn.style.display = 'none';
  syncDot.dataset.state = 'disabled';
  syncLabel.textContent = 'local';
}

searchInput.addEventListener('input', () => list.setQuery(searchInput.value));
newBtn.addEventListener('click', () => run(createNote));
deleteBtn.addEventListener('click', () => run(deleteCurrent));
exportBtn.addEventListener('click', () => run(async () => {
  const text = editor.getContent();
  try {
    await navigator.clipboard.writeText(text);
    saveState.textContent = 'Copied to clipboard';
  } catch {
    // Fallback for non-secure contexts / older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } finally { ta.remove(); }
    saveState.textContent = copied ? 'Copied to clipboard' : 'Copy failed — select and copy the text manually';
  }
}));
backBtn.addEventListener('click', () => run(async () => {
  const version = ++navigationVersion;
  if (!(await saveNow(true)) || version !== navigationVersion) return;
  document.body.classList.remove('note-open');
  if ((history.state as { note?: string } | null)?.note) history.back();
}));

// Android hardware/back: return to the note list instead of exiting.
window.addEventListener('popstate', () => {
  if (deleteDialog.open) deleteDialog.close('cancel');
  navigationVersion++;
  document.body.classList.remove('note-open');
  void saveNow(true);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void saveNow(true);
  else {
    const current = notes.find((note) => note.id === currentId);
    if (current) showCreationDate(current);
  }
});
window.addEventListener('pagehide', () => void saveNow(true));
window.addEventListener('beforeunload', (event) => {
  if (pendingEdits.size > 0) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// Ask the browser not to evict notes under storage pressure (granted silently when it wants to).
if (navigator.storage?.persist) {
  void navigator.storage.persist().catch((err) => console.warn('Persistent storage request failed:', err));
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

newBtn.disabled = true;
run(async function boot() {
  await refreshNotes();
  const last = localStorage.getItem(LAST_NOTE_KEY);
  if (last && notes.some((n) => n.id === last)) {
    await openNote(last);
    // Narrow screens start on the list; keep it that way after restore.
    if (window.matchMedia('(max-width: 799px)').matches) {
      document.body.classList.remove('note-open');
      history.replaceState(null, '');
    }
  }
  newBtn.disabled = false;
});
