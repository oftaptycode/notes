# `src/main.ts`

The browser entry point for the notes app. It grabs every DOM node by id, owns all application-level state (which note is open, the in-memory note list, the coalescing save queue, and three monotonic counters used as async stale-result guards), and wires together the CodeMirror editor, the virtualized note list, the mood controller, the decorative background, and optional Supabase auth + sync. It is the only module that mutates note content on disk; everything else it calls is either pure rendering or a single-purpose persistence helper.

**Depends on:** `./db`, `./editor`, `./list`, `./types`, `./supabase`, `./sync`, `./save`, `./dates`, `./mood`, `./noteBackground`, `../supabase/functions/_shared/moods`, `@codemirror/view`, `@supabase/supabase-js`
**Used by:** nothing — it is the app entry point, loaded directly by the bundler/`index.html`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| imports | 1-13 | pulls in db, editor, list, types, supabase, sync, save, dates, mood, noteBackground, CodeMirror `EditorView`, Supabase `Session` |
| `LAST_NOTE_KEY` | 15 | localStorage key holding the last-opened note id |
| DOM lookup + composition roots | 17-35 | finds every element once; constructs `noteBackground` and `mood` at module scope |
| `notes` / `notesById` | 37-38 | in-memory note list (descending `updatedAt`) plus an id index |
| `currentId` / `editorContent` | 39-40 | which note is open; the editor's local mirror of its content |
| `writeQueue` | 41 | tail of the promise chain that serializes all note writes |
| `pendingEdits` | 42 | at most one unflushed `Edit` per note id |
| `scheduled` | 43-45 | ids that already have a task appended to `writeQueue` |
| `navigationVersion` | 46 | stale-result guard for note open/create/delete/back flows |
| `refreshVersion` | 47 | stale-result guard for note reads |
| `editor` / `list` | 49-58 | editor created read-only; list row click routed through `run(() => openNote(id))` |
| `refreshNotes` | 60-69 | full reload of the note list at boot |
| `applyNotes` | 71-90 | splice changed notes into memory + list; invalidates in-flight reads |
| `reconcileCurrent` | 92-104 | keep the open editor in sync with the stored note, or close it |
| `refreshChangedNotes` | 106-117 | post-merge targeted re-read that retries around concurrent saves |
| `showCreationDate` | 119-124 | writes the `<time>` element text and machine-readable `datetime` |
| `hidden` / `pauseBackground` / `setEditorOpen` | 126-136 | pause the animated background when hidden or when no note is open |
| `clearCurrent` | 138-154 | tear down all per-note UI state |
| `queueEdit` | 156-175 | coalescing enqueue: one snapshot + one queued task per note |
| `flushEdits` | 177-205 | the drain loop that writes a note until nothing is pending |
| `saveChangedDocument` | 207-217 | editor `docChanged` handler; the typing hot path |
| `saveNow` | 219-240 | drain the queue, retry failures once, optionally discard a blank note; returns "safe to navigate" |
| `showNote` | 242-267 | open a note: editor, footer, mood, list highlight, history entry, focus |
| `openNote` | 269-280 | guarded save-then-read open, restarted if typing raced the read |
| `createNote` | 282-297 | guarded create of an empty note |
| `confirmDeletion` | 299-307 | `<dialog>` promise wrapper |
| dialog backdrop click handler | 309-315 | click outside the dialog cancels it |
| `deleteCurrent` | 317-336 | confirm, save, tombstone, close |
| `editor.onDocChange(saveChangedDocument)` | 338 | binds the typing path |
| `run` | 340-345 | fire-and-forget wrapper that surfaces async errors in the save-state slot |
| sync hookups (`onSyncStatus`, `onBeforeSync`, `onAfterMerge`) | 357-364 | status dot, save-before-sync gate, merge refresh |
| `updateAuthUI` | 366-376 | session-dependent button/form/dot state; also pushes the user id into `mood` |
| Supabase auth block | 378-446 | initial session lookup, auth state listener, sign in/out/sign up; `no supabase` fallback |
| toolbar handlers | 448-472 | search, new, delete, export-to-clipboard, back |
| A/B background flags | 474-479 | `?nolava` / `?lavacalm` class toggles for perf attribution |
| `popstate` | 481-487 | Android hardware back returns to the list and flushes saves |
| `visibilitychange` | 489-498 | flush on hide, refresh footer on show, pause/resume background |
| `pagehide` / `beforeunload` | 499-505 | best-effort flush; unload prompt only when edits are unflushed |
| `navigator.storage.persist()` | 507-510 | asks the browser not to evict IndexedDB |
| `visualViewport` resize handler | 512-523 | keeps the app sized to the on-screen keyboard and scrolls the cursor into view |
| boot | 525-539 | load notes, restore last note, enable the New button |

## Walkthrough

### Module wiring (lines 1-58)

Everything is looked up with `!` / `as` casts at module scope, so a markup rename fails immediately at load. `noteBackground` is created on `#editor-pane` (line 27-28) and injected into the mood controller (line 32), which is why mood is constructed *before* the editor and the list — the mood chip is the only consumer of the palette.

Initial UI state is "no note": the editor is non-editable (line 50) and Delete/Export are disabled (lines 51-52). `currentId` stays `null` until boot or a click.

### Two stale-result guards (lines 46-47, 60-117, 269-336)

Both counters are monotonically increasing `let`s and both work the same way: a flow captures its own token **before** the first `await`, and every continuation checks `token === counter` before touching shared state. Any later flow that bumps the counter silently invalidates everything the earlier flow still had in flight.

- `refreshVersion` guards **reads**. `refreshNotes` takes `++refreshVersion` at line 61 and re-checks after `getAllNotes()`; on mismatch it *recurses* (line 63) rather than returning, so the newest call is the one that wins. `refreshChangedNotes` does the same around `getNotes(ids)` but `continue`s in a `while (true)` loop (line 109-116).
- `navigationVersion` guards **navigation**. `openNote`, `createNote`, `deleteCurrent`, the Back button and `popstate` all bump it, and every `await saveNow(...)` / `await getNote(...)` / `await updateNotes(...)` is followed by a version check that returns early.

The subtle part is that `applyNotes` also bumps `refreshVersion` (line 72). That is deliberate: a save landing mid-read means the read's snapshot is already obsolete, and the newer in-memory state must win. `refreshChangedNotes` handles this by awaiting `writeQueue` *before* reading (line 110) and re-checking afterwards — the comment at lines 107-108 says exactly this. `applyNotes` therefore self-invalidates `refreshChangedNotes`' own read loop only on the *next* iteration, never retroactively.

Note that `refreshVersion` is bumped for its side effect in `applyNotes`, which is called on every save (line 192). Boot's `refreshNotes` can therefore recurse several times during the first save burst.

### In-memory model and the open editor (lines 71-104)

`applyNotes(changed)` mirrors `list.upsertItems`: remove the note from `notes`/`notesById`, skip it entirely if `note.deleted`, then binary-insert it back into the descending-`updatedAt` array (lines 79-85). The comment at line 87 is accurate: `upsertItems` re-runs `search.update(...)` and schedules filter/render asynchronously rather than doing DOM work inline.

`reconcileCurrent()` is the guard against the editor being clobbered:

- Line 93 — **if the open note has an unflushed edit, do nothing.** The DB copy is by definition older than what is on screen.
- Lines 95-96 — if the note vanished from memory (deleted locally or by a merge from another device), `clearCurrent()`.
- Lines 98-102 — otherwise, only if the stored content actually differs, reset `editorContent`, push into the editor, and tell the mood controller. The `!==` check makes this a no-op after our own save, so the cursor is never disturbed by a save completing.

### Background pausing (lines 126-136)

`pauseBackground()` toggles a single `lava-paused` class on `#editor-pane`, based on two inputs: the `hidden` module flag (only written by `visibilitychange`, line 490) and whether `body` has `note-open` (only written by `setEditorOpen`). Reading the class back off `document.body` rather than caching a boolean means the two inputs can never disagree.

Subtle: this is a **pause, not a stop**. `src/style.css:327` implements it as `animation-play-state: paused`, so the three drifting blobs freeze in place and resume seamlessly; they are not rewound. It also does not touch the `transition` on `--lava-1..3` (`src/style.css:227`), so a mood palette change can still crossfade while paused.

Call sites: `setEditorOpen` is invoked from `showNote` (line 256), `clearCurrent` (line 153), Back (line 470), `popstate` (line 485), and the boot restore (line 533). `pauseBackground()` is additionally invoked directly from `visibilitychange` (line 497) and at the end of boot (line 537). On narrow screens the editor pane is already `display: none` without `note-open` (`src/style.css:490`), so the class is belt-and-braces there; on desktop the pane stays visible with an empty, read-only editor, which is the case the comment at line 126 describes.

### The coalescing save queue (lines 156-205)

This is the part worth reading twice. The invariant, stated in the comment at lines 43-45 and 156-158, is: **at most one queued write task and at most one snapshot per note, no matter how fast the user types.**

`queueEdit(edit)` (lines 165-175) does two things:

- `pendingEdits.set(edit.id, queued ? { ...edit, previousContent: queued.previousContent } : edit)` — take the **newest content**, but keep the **oldest unflushed baseline**.
- `if (scheduled.has(edit.id)) return;` — if a drain task for this note is already on the chain, do nothing. Otherwise mark it scheduled and append `flushEdits(id)` to `writeQueue`.

`flushEdits(id)` (lines 177-205) loops: take the entry, **delete it before the `await`** (line 184), write it, then loop again. Deleting first is what lets a keystroke that lands mid-write create a *fresh* entry that the next iteration picks up, instead of being silently dropped. The `finally` at lines 202-204 always clears `scheduled`, so a note whose write failed can be re-queued later.

Why the first baseline is retained, concretely: suppose the DB holds `"A"` (already flushed) and the user types three more characters, producing edits `B(prev=A)`, `C(prev=B)`, `D(prev=C)`. Coalescing with the *first* baseline gives `{content:'D', previousContent:'A'}`. `saveEdit` compares the stored note against `previousContent` (`src/save.ts:18`) and sees `'A' === 'A'`, so it writes without producing a conflict copy. Coalescing with the *latest* baseline would give `previousContent:'C'`, the stored `'A'` would look like someone else's edit, and `saveEdit` would write a `conflictCopy('A')` — a spurious duplicate note containing the text the user had already replaced. Retaining a later baseline would therefore convert the user's own coalesced keystrokes into fake conflicts, and with one snapshot per note those fakes could not be deduplicated afterwards.

Error handling at lines 193-200: the failed edit is put back into `pendingEdits` **only if nothing newer arrived while it was being written** (line 197), so a failed write can never clobber a newer edit. The function then `return`s (no infinite retry loop) and the message tells the user their text is still on screen. `saveState` is only set to `'Saved'` when there is nothing newer pending (line 189), so the label cannot lie about unsaved keystrokes.

### Typing path and draining (lines 207-240)

`saveChangedDocument` is the `docChanged` handler (bound at line 338). It compares `editor.getContent()` against `editorContent`, and on a change: builds the edit, updates `editorContent` **first**, calls `mood.updateContent`, sets `'Saving…'`, and queues. Emptying a note is persisted like any other edit — deletion happens inside `saveEdit`, not here.

`saveNow(discardEmpty)` (lines 219-240) has three distinct jobs:

1. **Drain** (lines 221-224). The `do { queue = writeQueue; await queue } while (queue !== writeQueue)` identity loop waits until no new task has been appended during the await. Because `queueEdit` does *not* append for a note that is already scheduled, `writeQueue` only grows when a *different* note gets an edit, so this loop terminates in practice.
2. **Retry failures once** (lines 226-230). This step is not redundant with the drain above: a keystroke arriving *during* a write creates a new `pendingEdits` entry without appending a new task (because `scheduled` still holds the id), so the first drain can complete with work pending. Line 226 re-queues those entries and line 227-230 drains again.
3. **Optionally discard a blank note** (lines 231-238). `saveChangedDocument` early-returns when `content === editorContent`, so a note the user created and never typed into never produces an edit. `saveNow(true)` — used when *leaving* a note — queues the blank edit so `saveEdit` tombstones it and it vanishes from the list.

Note the ordering in `createNote`: the discard check runs at line 284 and again at line 295, both *before* `showNote(newNote)`, so `currentId` still points at the outgoing note. That is what the comment at line 231 means — the freshly created blank note is never immediately deleted, because it is not `currentId` yet.

The return value `pendingEdits.size === 0` (line 239) is the single "is it safe to navigate away" signal used by every navigation path.

### Opening, creating, showing (lines 242-297)

`showNote` is pure UI. It collapses the "reset the editor" branch to only run when the id or content actually changed (lines 243-247), so re-showing the same note preserves the cursor. It always calls `mood.openNote(note.id, note.content)` — the mood controller freezes that content as its analysis input.

History handling (lines 257-264) runs only at `max-width: 799px` and maintains **one** editor entry: the first open `pushState`s, later opens `replaceState` onto it, so Android back goes to the list rather than walking a history of every note you opened. Focus is forced at line 266.

`openNote(id)` (lines 269-280) is the clearest example of the guard pattern:

- Take the token, then loop *while still current*.
- `saveNow(true)` — if it returns `false`, navigation is aborted rather than losing text.
- `await getNote(id)`, re-check the token.
- Line 276: `if (pendingEdits.size > 0) continue;` — anything typed while the read was in flight means the read was taken against a moving target, so restart the whole save-then-read cycle.

Subtle: line 276 checks the **global** `pendingEdits` map, not just the outgoing note's entry, despite the comment saying "belongs to the old document". An unrelated note being written concurrently will also force a retry. It is stricter than the comment implies, but safe.

### Deleting (lines 299-336)

`confirmDeletion` returns a promise from the `<dialog>`'s `close` event, with `{ once: true }`, and pre-sets `returnValue = 'cancel'` so Escape resolves `false`.

`deleteCurrent` captures `requestedVersion` *before* showing the dialog (line 320) and re-checks it afterwards (line 321), so a note opened while the dialog is open cancels the deletion. It then takes a *new* token, drains with `saveNow()` (no `discardEmpty` — an emptied note must not be tombstoned twice), and tombstones via `updateNotes`. Line 328's `Math.max(Date.now(), note.updatedAt + 1)` forces `updatedAt` strictly forward, preserving the descending order invariant that `applyNotes`' binary insert depends on.

`clearCurrent()` is called at line 332 *before* `applyNotes(changed)` at line 335, so `reconcileCurrent` sees `currentId === null` and does nothing.

### Auth and sync (lines 347-446)

The sync hooks are registered at module scope, outside the `if (supabase)` block, so they are wired even in local-only mode:

- `onSyncStatus` (357-360) drives the dot's `data-state` and the label text.
- `onBeforeSync` (361-363) **throws** when `saveNow()` returns `false`, which aborts the sync run rather than pushing a partially-saved note.
- `onAfterMerge(refreshChangedNotes)` (364) hands the changed ids to the retrying read.

`authVersion` (line 379) is a *third*, independent guard: the initial `getSession()` promise and the `onAuthStateChange` listener race, and whichever resolves first wins (lines 384-385, 390). `updateAuthUI` pushes the user id into the mood controller first (line 367), so the mood controller can begin its (cache-only) pass as soon as auth resolves — see `mood.ts` `setUser`.

When `supabase` is absent (442-446) the auth button is hidden and the dot is forced to `disabled`; `mood.setUser` is never called, so `userId` stays `null`, but `mood`'s own `!supabase` branch renders the more accurate `'unavailable'` message.

### Toolbar, history, lifecycle (lines 448-523)

- Export (451-466) tries the async Clipboard API and falls back to a hidden `<textarea>` + `execCommand('copy')`, always removing the textarea in a `finally`.
- Back (467-472) bumps `navigationVersion`, drains with `discardEmpty`, closes the editor and calls `history.back()` — which re-enters the `popstate` handler (line 482), which does `setEditorOpen(false)` and `saveNow(true)` again. Redundant, but both are idempotent.
- `popstate` also closes the delete dialog if it happens to be open (line 483) and invalidates any in-flight navigation, which is what makes Android hardware back safe.
- `visibilitychange` (489-498) flushes on hide and, on show, re-renders the creation date from the in-memory note. Subtle: the fresh date is only refreshed on becoming visible, so a note that sat open across a long session shows the date captured at `showNote` time until the tab is backgrounded and restored.
- `pagehide` (499) fires `saveNow(true)` without awaiting — browsers do not wait for it. It is best-effort only.
- `beforeunload` (500-505) prompts **only** when `pendingEdits.size > 0`. An edit that is mid-`await` inside `saveEdit` has already been removed from the map (line 184), so a single in-flight write does not trigger the prompt. This is the deliberate trade for keeping the map at one entry per note.
- `visualViewport` (512-523) pins `appEl` to the visual viewport height and scrolls the cursor line into view, which keeps the caret above the Android keyboard.

### Boot (lines 525-539)

`refreshNotes()` → restore `LAST_NOTE_KEY` if that note still exists → on narrow screens immediately `setEditorOpen(false)` and `history.replaceState(null, '')`, which undoes the `pushState` that `showNote` just performed. Then `pauseBackground()` (537) sets the initial paused state, and only then is the New button enabled (538) so it cannot be clicked before `notes` is populated.

## Gotchas

- `editorContent` is the authority for `previousContent` baselines. `reconcileCurrent` must keep skipping it while the open note has a pending edit (line 93), or an in-flight read would replace the editor's text with older content and corrupt the next edit's baseline.
- `pendingEdits` is checked as a *global* "unsaved work exists" flag in four places (lines 93, 232, 276, 501). It is not scoped to the current note; behaviour is stricter than the call sites' wording suggests.
- The queue bound is "one *task* per note". The map entry is deleted before each `await`, so a note can momentarily have a newer snapshot in the map while its previous write is still in flight. Only one snapshot exists at a time.
- `applyNotes` bumping `refreshVersion` (line 72) is load-bearing, not cosmetic. Removing it would let a stale `getAllNotes()`/`getNotes()` result clobber a just-saved note.
- `refreshNotes` recurses on staleness (line 63) rather than returning; a save burst during boot can stack several concurrent `getAllNotes()` calls.
- Never append to `writeQueue` outside `queueEdit`, and never set `pendingEdits` without going through it — `saveNow`'s `queue !== writeQueue` drain loops (lines 221-224, 227-230, 234-237) assume all writes flow through the single chain.
- `clearCurrent()` does not touch `saveState`, which is why `'Empty note discarded'` and `'Save failed — …'` survive the editor closing. It also calls `mood.clear()`, which permanently deletes that note's mood cache.
- `deleteCurrent` uses `saveNow()` without `discardEmpty` on purpose; passing `true` would attempt a blank-note deletion and a tombstone for the same note.
- History entries exist only at `max-width: 799px`. `history.state.note` is the flag used to decide `pushState` vs `replaceState` (line 259) and whether to `history.back()` (lines 333, 471).
- The `hidden` flag is written *only* by `visibilitychange` (line 490), so a page loaded in a background tab never sets it. Harmless in practice, since nothing is painted.
- `pauseBackground` only pauses the blob animations; the `--lava-1..3` colour transition in `src/style.css:227` still runs.
