# `src/types.ts`

The app's shared vocabulary: the `Note` record that everything else stores and
transports, plus the three pure helpers that mint ids, build conflict backups,
and derive a human-readable title from raw Markdown. Every other module imports
from here, and nothing in here imports from the app, so it is safe to load from
a worker or an edge function.

**Depends on:** nothing
**Used by:** `db.ts`, `list.ts`, `main.ts`, `save.ts`, `sync.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `Note` | 1-14 | The persisted note record, including sync bookkeeping |
| `conflictCopy` | 16-26 | Builds a fresh dirty note holding displaced text |
| `newId` | 28-35 | UUID v4, native or hand-rolled fallback |
| `TITLE_TRIM` | 39 | Single-character whitespace matcher for the title scan |
| `TITLE_WINDOW` | 44 | Max characters copied out of a candidate title line |
| `titleFromContent` | 46-61 | First nonempty line, de-marked-up, capped at 80 chars |

## Walkthrough

### `Note` (lines 1-14)

One flat record used both as the IndexedDB row and as the sync wire shape.
`updatedAt` is a local number, not the server timestamp — it is what the list
sorts by and what the `updatedAt` index in `db.ts` is built on.

`synced` (lines 9-13) is the "last server state this device acknowledged" shadow
copy. `db.ts` reduces it to a single `revision` string in the `syncMetadata`
store, so it is optional: the comment on line 8 notes it is absent on notes that
predate the sync feature, and `metadataFor` tolerates that with `?? null`.

### `conflictCopy` (lines 16-26)

Produces a brand-new, non-deleted, `dirty` note whose content is the displaced
text prefixed with `(conflict copy)`. It deliberately does not copy `synced`, so
the copy is queued for upload by `getDirtyNotes()`.

The `dirty: true` matters: a conflict copy the user never looks at still has to
reach the server eventually, otherwise a later server pull would resurrect the
original text over it. Used by both `save.ts` (keystroke-level conflicts) and
`sync.ts` (server-merge conflicts).

### `newId` (lines 28-35)

`crypto.randomUUID` when available, otherwise a template-replaced UUID v4. The
`'randomUUID' in crypto` guard (line 29) is about non-secure contexts, where the
`crypto` object exists but lacks the method; the fallback is a plain
`Math.random()` v4 layout (lines 31-33), which is fine because these ids are
client-generated and never security-bearing.

### `titleFromContent` (lines 46-61)

Called on every card render and on every delete-dialog open, so it must stay
cheap for notes that can be hundreds of KB.

- Lines 48-50 locate the next line boundary with `indexOf` instead of
  `split('\n')`, which would allocate an array of every line.
- Lines 52-53 step over leading whitespace using a single-character regex
  (`TITLE_TRIM`, line 39). Subtle: `\s` in JS matches exactly the code-point set
  `String.prototype.trim` removes, including `\uFEFF` and `\u2028/\u2029` — the
  comment on line 37 is accurate, and this is the same set `isBlankContent`
  hardcodes on the server side.
- Line 56 copies at most `TITLE_WINDOW` (1024) characters out of the line. The
  80-character display cap on line 58 is applied after the Markdown-prefix
  stripping on line 57, so a title like `# ` followed by 2000 characters still
  yields a valid, correctly-prefix-stripped title.
- Line 60 returns `'Untitled'` when every line is blank.

Because the ellipsis on line 58 is added after slicing to 80, the result is at
most 81 characters.

## Gotchas

- `titleFromContent` truncates at 1024 characters *per candidate line*, then at
  80. A single-line note never has its whole text copied, but it is still
  `indexOf`-scanned from index 0 until the first non-blank line is found.
- `conflictCopy` always produces a note whose `updatedAt === createdAt`, so a
  bulk conflict can insert several copies with identical timestamps. The
  `updatedAt` binary inserts in `list.ts` are stable under ties, so this only
  affects ordering aesthetics.
- `Note.synced` being optional is load-bearing in `db.ts`; adding a required
  field here will break every stored record that lacks it.