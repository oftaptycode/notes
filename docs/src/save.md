# `src/save.ts`

The single write path for editor keystrokes. `saveEdit` takes one editor buffer
and commits it to IndexedDB through `db.updateNotes`, deciding on the fly whether
the edit collided with something else (another tab, or a server merge) and, if
so, leaving a `(conflict copy)` behind so no text is ever silently lost.

**Depends on:** `db.ts` (`updateNotes`), `types.ts` (`conflictCopy`, `Note`), `supabase/functions/_shared/moods.ts` (`isBlankContent`)
**Used by:** `main.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `Edit` | 5-9 | One pending buffer: new text plus the text the editor had loaded |
| `saveEdit` | 12-29 | Compare-and-swap write that may emit a conflict backup |

## Walkthrough

### `Edit` (lines 5-9)

`previousContent` is not "the previous keystroke" — it is the content the editor
was last synchronized with. `main.ts` (line 161 comment) keeps it so that
`saveEdit` can tell "this is my own next keystroke" apart from "someone else
overwrote the row while I was typing". Without it, a stale buffer would
unconditionally clobber a newer write.

### `saveEdit` (lines 12-29)

The function is `async` but the callback passed to `updateNotes` is synchronous,
which `db.ts` requires (see its line 135 comment: never hold an IndexedDB
transaction open across network I/O).

Order of operations inside the transaction callback:

1. Line 14 computes `deleted` from `isBlankContent` **outside** the callback.
   The comment on line 13 explains why: `content.trim()` would allocate a copy of
   the entire note on every keystroke. The shared helper does the same check as
   an index scan, and hoisting it out of the callback also keeps the transaction
   body to pure in-memory work.
2. Line 16 throws if the row is gone. `updateNotes` catches, aborts the
   transaction, and rethrows, so the caller sees a rejection. The message is
   user-facing text about how to recover.
3. Line 17 is the no-op fast path: same content and same tombstone flag means
   this save is a duplicate (for example a re-entrant flush from the write
   queue) and it returns the existing row unchanged, avoiding a needless
   `updatedAt` bump and a `dirty` flag.
4. Lines 18-20 decide whether to back up. A backup is created when either
   - `current.content !== edit.previousContent` — the stored text is not what
     the editor started from, so something else wrote in the meantime; or
   - `current.deleted && !current.dirty` — the row was a *synced* tombstone, so
     the deletion has already been acknowledged by the server and resurrecting it
     would race the remote delete.

   Subtle: a tombstone that is still `dirty` (deleted on this device, not yet
   uploaded) deliberately takes the second branch's exemption and gets no
   backup. The deletion has not escaped the device, so there is no remote state
   to preserve.
5. Lines 21-27 write the new row first, then the backups. `updatedAt` on line 26
   is `Math.max(Date.now(), current.updatedAt + 1)`, not plain `Date.now()`:
   two saves inside the same millisecond would otherwise tie, and `updatedAt` is
   both the list's sort key and an IndexedDB index. The `+ 1` guarantees strict
   monotonicity.
6. Line 25 always sets `dirty: true`, which is what queues the note for the
   Supabase upload in `sync.ts`.

The array returned by `updateNotes` is the full write set, so the return value of
`saveEdit` may contain more notes than the one edited. `main.ts` feeds it straight
into `applyNotes`, which is why conflict copies appear in the list immediately.

## Gotchas

- `previousContent` must be the content that was last **written to IndexedDB** for
  this note — not the last keystroke, and not `Note.synced` (which means
  *server-acknowledged*, a different and later milestone). Because `main.ts`
  coalesces queued edits, this is the *first unflushed* edit's baseline: see the
  comment at `main.ts` lines 160-164. Passing a later baseline causes spurious
  conflict copies; passing a stale one causes silent clobbering.
- The `current.deleted === deleted && current.content === edit.content` check on
  line 17 compares content as well as the flag, so a blank-to-blank save of an
  already-tombstoned row still returns `[current]` and does not re-bump
  `updatedAt`.
- `saveEdit` can throw (line 16). Callers must handle the rejection; the message
  assumes the editor is still open.
- Backups are written in the same transaction as the edit, so a conflict copy and
  the overwritten note are atomic together — you cannot get one without the other.