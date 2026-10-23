# `src/db.ts`

The app's only persistence layer: a thin, typed wrapper over IndexedDB (via
`idb`) that stores `Note` records in a `notes` object store and mirrors each
note's *sync* state into a parallel `syncMetadata` store. It also performs a
one-time, idempotent import from an older database name (`shita-notes`) kept as
a recovery backup. Everything the UI and the optional Supabase sync read or
write goes through the exported functions here.

**Depends on:** `idb`, `./types` (type-only)
**Used by:** `src/main.ts`, `src/sync.ts`, `src/save.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `DB_NAME` | 4 | Database name constant (`notes-db`) |
| `SyncMetadata` | 5-9 | Row shape: id, server revision, 0/1 dirty flag |
| `NotesDB` | 10-13 | `DBSchema` typing for the two stores and their indexes |
| `metadataFor` | 14-16 | Derives a `SyncMetadata` row from a `Note` |
| `openNewDB` | 18-41 | `openDB` call plus the version-2 upgrade/migration |
| `migrateLegacy` | 44-70 | Copies notes out of the legacy `shita-notes` database |
| `dbPromise` / `getDB` | 72-84 | Memoized connection promise |
| `getAllNotes` | 86-90 | Live notes, newest-updated first |
| `getNote` | 92-95 | Single note by id, including deleted |
| `putNote` | 97-99 | Whole-note write, delegating to `updateNotes` |
| `getDirtyNotes` | 101-108 | Unsynced notes, via the `dirty` index |
| `getSyncRevisions` | 110-114 | id → last acknowledged server revision map |
| `hasDirtyNotes` | 116-119 | Cheap "is anything unsynced" check |
| `getNotes` | 121-127 | Batch read by ids, dropping misses |
| `getAllIncludingDeleted` | 129-132 | Raw read with no filter or sort |
| `updateNotes` | 136-155 | Read-modify-write inside one transaction |

## Walkthrough

### Schema and metadata mirror (lines 4-16)

- `notes` is keyed by the note's own `id` (`keyPath: 'id'`, line 22) with an
  `updatedAt` index (line 23). That index exists for the schema but no query in
  this file uses it — `getAllNotes` reads every row and sorts in memory
  (line 89).
- `syncMetadata` (lines 12, 25-26) duplicates only three fields per note so the
  sync layer can ask "what is unsynced?" without deserializing full note
  content. It is the reason `updateNotes` has to write two stores atomically.
- `metadataFor` (lines 14-16) is the single place that projection happens:
  `revision` is `note.synced?.serverUpdatedAt ?? null`, so a note with no
  `synced` block (an existing, never-synced note) gets `null` rather than
  `undefined`, and `dirty` is normalized from boolean to the numbers `1`/`0`
  so it can be used as an IndexedDB index key.

### `openNewDB` and the upgrade path (lines 18-41)

- Opens `notes-db` at **version 2** (line 19). Inside `upgrade`:
  - `oldVersion < 1` (lines 21-24) creates the `notes` store and its index —
    fresh installs and v0 upgrades.
  - Lines 25-26 create `syncMetadata` **unconditionally**, with no
    `oldVersion < 2` guard. Creating a store is safe to do on every upgrade
    path, and it means a v1 database gains the store on its first v2 open.
  - Lines 28-34 walk a cursor over `notes` and backfill a `syncMetadata` row
    for every existing note. The comment on line 27 explains the motivation:
    existing installations must not have their notes rewritten or discarded,
    so the new store is populated from what is already there rather than by
    re-saving through the normal write path.
  - subtle: this backfill is fired with `void ...` and **not** awaited, yet it
    runs inside the upgrade transaction. It relies on the fact that each
    `await cursor.continue()` resumes on a microtask, before IndexedDB can
    auto-commit the transaction; the `.catch(() => tx.abort())` (line 34)
    exists so a failed backfill rolls the upgrade back rather than leaving a
    half-populated store. Because it is un-awaited, the upgrade still resolves
    once the transaction commits, and re-running the upgrade simply rewrites
    the same metadata rows.
- `blocking` (lines 36-39) handles another tab holding an older version open:
  it closes *its* `IDBDatabase` connection and drops the module-level
  `dbPromise` so the next call reopens at the current version. subtle: the
  assignment at line 38 reaches a `let` declared later in the module (line 72);
  that is safe only because the handler can never fire during module
  evaluation.

### `migrateLegacy` (lines 44-70)

- The guard on line 47 is `(await indexedDB.databases?.()) ?? []`. The
  optional call tolerates browsers (and older test environments) without
  `indexedDB.databases()`; when the API is missing the list is empty, so
  `.some(...)` on line 48 is false and the function returns early — the legacy
  import silently does not happen rather than throwing.
- Line 48 looks for the legacy database by name before opening it, so the
  common case costs one call and opens nothing.
- Line 50 reads the legacy `notes` store wholesale; there is no paging, so a
  very large legacy database is held in memory at once.
- The write loop (lines 53-58) is **idempotent**: line 54 checks whether the id
  already exists and only then writes the note (line 55) and its metadata row
  (line 56). Re-running the migration never clobbers a note the user has since
  edited in the new database.
- Error handling is deliberately asymmetric. Inside the transaction, the
  catch (lines 60-64) aborts, swallows the resulting `tx.done` rejection
  (line 62 — `done` rejects whenever the transaction aborts), and rethrows so
  the outer handler logs. The outer catch (line 65-67) only `console.warn`s:
  a failed migration must not stop the app from opening the new database. The
  `finally` (lines 67-69) always closes the legacy handle.
- The comment on line 43 records the deliberate policy: the old database is
  never deleted, so a bad import is recoverable by hand.

### Connection memoization (lines 72-84)

- `getDB()` caches the promise, not the database, so concurrent callers share
  one open plus one migration. `openNewDB` runs first and `migrateLegacy`
  second (lines 76-77), so no caller can read the database before the legacy
  import has finished.
- The `catch` (lines 79-82) resets `dbPromise = undefined` before rethrowing,
  which is what makes a failed open retryable rather than permanently cached
  as a rejected promise.

### Queries (lines 86-132)

- `getAllNotes` (line 89) filters `deleted` tombstones out and sorts by
  `updatedAt` descending — the note list order.
- `getDirtyNotes` (lines 103-107) opens a **readonly** transaction across both
  stores and uses `index('dirty').getAllKeys(1)`. subtle: the `1` here is the
  index *key query*, not a result-count limit — that is why exactly the rows
  whose `dirty` was normalized to `1` are returned. Line 107 re-checks
  `note?.dirty` on the fetched rows, so a stale index entry cannot leak a note
  that is actually clean.
- `getNotes` (line 123) similarly wraps a batch of `get`s in one transaction
  and awaits `tx.done` so it cannot read across a concurrent write.
- `hasDirtyNotes` (line 118) uses `countFromIndex` so the sync scheduler can
  poll cheaply without materializing any note.
- `getNote` (line 94) and `getAllIncludingDeleted` (line 131) deliberately skip
  the `deleted` filter — they are the read paths for a specific note and for
  whole-store operations respectively.

### `updateNotes` (lines 136-155)

- This is the module's central write primitive: read current (line 143), let
  the callback compute the full set of resulting notes, then write each one to
  both stores (lines 144-147), all inside one `readwrite` transaction
  (line 141).
- The callback receives `Note | undefined` and returns `Note[]` — an array
  because a single logical operation can produce more than one row. `sync.ts`
  uses this to write a conflict backup alongside the edited note; the comment
  on line 134 names that case explicitly.
- subtle and load-bearing: the callback **must be synchronous** (line 135). An
  IndexedDB transaction auto-commits as soon as the microtask queue drains
  with no pending request, so a single `await` on network I/O inside the
  callback would commit the transaction out from under the remaining writes.
- Error handling mirrors `migrateLegacy` (lines 150-153): abort, swallow the
  `done` rejection, rethrow. Nothing is returned on failure, so callers can
  treat a resolved promise as "all rows committed".
- `putNote` (lines 97-99) is a thin convenience over this — it replaces the
  callback with a constant so metadata stays in lockstep with the note.

## Gotchas

- **Two stores, one write.** Anything that writes `notes` directly would
  desynchronize `syncMetadata`. Every write must go through `updateNotes` (or
  `putNote`, which delegates to it).
- **`dirty` must stay numeric.** `metadataFor` (line 15) stores `1`/`0`, not
  `true`/`false`, because `getDirtyNotes` (line 104) and `hasDirtyNotes`
  (line 118) query the index for the key `1`.
- **`deleted` is a soft delete.** Tombstones stay in `notes` and are excluded
  only by `getAllNotes` (line 89); sync and conflict handling still need them.
- **Callbacks in `updateNotes` may not await anything**, per the contract on
  line 135.
- `getAllNotes` sorts in JS despite the `updatedAt` index existing.
- `migrateLegacy` never deletes or writes to `shita-notes`, and its failures
  are logged rather than propagated (line 66).
