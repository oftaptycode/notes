# `src/editor.ts`

The CodeMirror 6 factory for the note pane. It builds the `EditorView`, wires up
Markdown parsing and the app's decoration/highlight pipeline, and wraps the
view in a small `EditorHandle` façade so the rest of the app never touches
CodeMirror's state or transaction API directly.

**Depends on:** `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/lang-markdown`, `@lezer/markdown`, `./guillemets`, `./markdown`
**Used by:** `src/main.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `EditorHandle` | 9-15 | Public façade interface returned by `createEditor` |
| `createEditor` | 17-78 | Builds the view and its handle |
| `createState` | 24-50 | Assembles a full `EditorState` from a document string |
| `editability` / `editingExtensions` | 21-22 | Compartment holding read-only + contenteditable |
| `docChangeHandler`, `suppress`, `editable` | 18-20 | Module-local mutable state |
| `getContent` | 59 | Reads the current document text |
| `setContent` | 60-69 | Replaces the document and the whole state |
| `setEditable` | 70-73 | Toggles read-only and contenteditable |
| `onDocChange` | 74-76 | Registers the single document-change callback |

## Walkthrough

### Extension set in `createState` (lines 24-50)

- `editability.of(editingExtensions())` (line 28) installs the mutable
  compartment. Because `createState` runs on *every* state creation, a new
  document always starts with the current `editable` value rather than
  resetting to the default.
- `markdown({ extensions: [GFM, Guillemets] })` (line 31) registers the
  standard GFM table/strikethrough/autolink parsing plus the app's custom
  `«…»` inline delimiter from `guillemets.ts`.
- `markdownFormatting` (line 32) is imported from `./markdown`, not defined
  here. That module carries the heavy lifting: syntax highlighting with
  `mdHighlightStyle` plus the incremental decoration `StateField` that hides
  Markdown markers and styles headings/links/quotes (see `src/markdown.ts`).
- `EditorView.theme` (lines 34-38) deliberately sets `backgroundColor:
  'transparent'` and reads `var(--fg)` / `var(--accent)` from the CSS custom
  properties, so the editor inherits the app's theme (including the animated
  background behind the open note) rather than defining its own colors.
- `EditorView.contentAttributes` (lines 39-44) sets the mobile keyboard and
  accessibility behaviour: `aria-label` for screen readers, plus
  `autocapitalize: 'sentences'`, `autocorrect` and `spellcheck` enabled for
  on-device keyboards.
- `EditorView.lineWrapping` (line 33) — notes are prose, so long lines wrap
  instead of scrolling horizontally.

### Change notification and `suppress` (lines 18-19, 45-47)

- `docChangeHandler` is a single slot, not a list: `onDocChange` (line 75)
  overwrites any previous callback. `src/main.ts:338` registers exactly one
  (`saveChangedDocument`).
- The update listener (lines 45-47) fires only when `u.docChanged` is true and
  `!suppress`. A selection move, a decoration update, or the scroll-to-top
  dispatch on line 65 does not reach the save path.
- subtle: `suppress` is set around `view.setState(...)` in `setContent`
  (lines 62-68) and reset in a `finally`. `setState` replaces the entire state
  object, so any `updateListener` it fires is a *document replacement*, not a
  user edit — without the guard, loading a note would immediately be treated as
  an unsaved change and re-queued as a write.

### `setContent` and history (lines 60-69)

- `setContent` rebuilds the state from scratch (`view.setState(createState(text))`)
  rather than dispatching a change that replaces the document range. The
  comment on line 61 states why: each document gets its own history, so
  opening a note is not an edit and does not put "revert to note A" in the undo
  stack of note B. The practical consequence is that undo cannot cross a note
  boundary.
- Line 65 then dispatches `EditorView.scrollIntoView(0)`, jumping the viewport
  to the top of the newly loaded document. This dispatch is inside the
  `suppress` window as well, though it changes no document anyway.

### `setEditable` (lines 70-73)

- Toggling sets both `EditorState.readOnly` and `EditorView.editable`
  (line 22) inside one compartment reconfigure. `readOnly` blocks CodeMirror's
  commands; `editable` controls the `contenteditable` DOM attribute and so the
  caret and IME behaviour. Both are needed because the app uses the read-only
  state as a *display* mode — `main.ts:50` and `main.ts:146` disable editing
  when no note is open or the document is cleared, and `main.ts:249` enables it
  in `showNote`.

## Gotchas

- `onDocChange` replaces the previous handler; there is no unsubscribe and no
  way to register more than one.
- `view` is exposed on the handle (line 58), and `main.ts` does use it directly
  for focus (`main.ts:266`) and a manual `scrollIntoView` dispatch
  (`main.ts:518-519`) — the façade is a convenience, not a hard boundary.
- `setContent` resets undo history and scroll position as a side effect.
- `suppress` is synchronous around `setState`; anything asynchronous that
  depends on the change handler firing will not run.
- The handler receives no arguments, so callers must read content themselves
  via `getContent`.
