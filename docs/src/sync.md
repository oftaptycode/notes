# `src/sync.ts`

The optional two-way sync engine. The app is local-first: every note lives in
IndexedDB and works offline; this module reconciles that store with a Supabase
`notes` table when a session exists. Each run *pulls first* (list every remote row's
revision, download only the bodies whose revision moved, merge them through
compare-and-swap logic that never clobbers an unsynced local edit), then *pushes*
locally dirty notes with a conditional update, backing up the remote version into
a `(conflict copy)` note whenever both sides changed. It is a module-level engine
with a single-flight lock, a status callback for the sync dot in the header, and
triggers on typing, visibility, and network events.

**Depends on:** `./db`, `./supabase`, `./types`
**Used by:** `src/main.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `SyncStatus` | 5 | The seven states the header dot can display |
| `PAGE_SIZE` | 7 | Row cap per Supabase query, 200 |
| `running` | 8 | Module-global single-flight flag |
| `statusListener` | 9 | Status callback slot (single, not a list) |
| `beforeSyncListener` | 10 | Awaited hook to flush local edits before syncing |
| `afterMergeListener` | 11 | Awaited hook to refresh just the changed notes |
| `onSyncStatus` | 13 | Registers the status callback |
| `onBeforeSync` | 14 | Registers the pre-sync flush hook |
| `onAfterMerge` | 15 | Registers the post-merge refresh hook |
| `RemoteRow` | 17-25 | Shape of a `notes` table row |
| `sameContent` | 27-29 | Content + deleted equality, ignores timestamps |
| `syncedState` | 31-34 | Build `Note['synced']`, rejecting rows with no revision |
| `rowToNote` | 36-46 | Convert a remote row into a fresh clean local note |
| `mergeRemote` | 48-65 | The four-way merge decision, inside one IndexedDB transaction |
| `readRemote` | 67-72 | Single-row fetch used to resolve optimistic-write races |
| `pushNote` | 74-111 | Conditional update/insert with up to 3 race-retry attempts |
| `sync` | 113-199 | The engine: gate, auth, pull, merge, concurrent push, status |
| `editTimer` | 201 | Handle for the debounce timer |
| `syncSoon` | 202-208 | 3-second debounced `sync()` trigger |
| (module init) | 210-217 | 30s visibility timer, `visibilitychange`, `online`, `offline` |

## Walkthrough

### Listener wiring (lines 9-15)

Three single-slot module globals rather than an event emitter or an array —
`main.ts` calls each `on*` exactly once at startup (lines 357-364). A second call
silently replaces the first, so there is no unsubscribe and no way to register two
consumers. `beforeSyncListener` is `() => Promise<void>` and `afterMergeListener`
is `(ids: string[]) => void | Promise<void>`; both are awaited, so a failing
IndexedDB flush or a failing UI refresh aborts the run rather than being swallowed.

### `sameContent` / `syncedState` / `rowToNote` (lines 27-46)

`sameContent` (27-29) takes `{content, deleted}` from both a `Note` and a
`RemoteRow` and compares only those two fields. Both call sites lean on that
structural looseness — line 55 compares a `Note` against a `RemoteRow`, line 56
compares `local.synced` against a `RemoteRow` — so `serverUpdatedAt` and
`updated_at` deliberately do not participate. It answers "are these the same
document?", which is the only question the dirty flag cares about.

`syncedState` (31-34) throws if `server_updated_at` is missing. That column is the
optimistic-concurrency token used at line 87 and the revision key compared at
line 153; a row without it cannot participate in either, so failing loudly beats
silently writing an unsyncable note.

`rowToNote` (36-46) converts a remote row into a brand-new local note with
`dirty: false` and `createdAt`/`updatedAt` parsed from ISO strings. Used only when
the local record is absent or clean (lines 54) — never to overwrite a dirty note.

### `mergeRemote` (lines 48-65)

The decision table, and the heart of the conflict policy. All of it runs inside
the synchronous callback of `updateNotes` (see `db.ts:136-155`), which reads,
compares, and writes in a single IndexedDB readwrite transaction covering both the
`notes` and `syncMetadata` stores. That is what makes it safe against another tab
editing the same note concurrently — the compare and the write are not separable.

Ordered by cost, cheapest first:

- **Line 53** — revision already matches: `return []`. No `put`, no
  `syncMetadata` write, no entry in `changed`, so no UI refresh. This is the hot
  path for the "remote row unchanged" case.
- **Line 54** — no local record, or a clean one: overwrite wholesale with
  `rowToNote(row)`.
- **Line 55** — local is dirty but its content already equals the remote content:
  just adopt the remote revision and clear `dirty` (the writes converged).
- **Line 56-59** — `local.synced` equals the remote content: only the local
  document changed since the acknowledged server state. Adopt the new revision but
  leave `dirty: true` so the next push overwrites the server.
- **Line 62** — both sides changed (or a legacy note has no `synced` baseline):
  return two notes — `{...local, synced}` (local text kept, still dirty, new
  baseline) *and* `conflictCopy(row.content)`, a fresh dirty note prefixed with
  `(conflict copy)` carrying the remote text.

The upshot of line 62 is that a real conflict resolves as **last-writer-wins plus a
preserved backup**: the local text wins the row, the remote text is never lost.
`updateNotes` writes both, and `conflictCopy` (types.ts:16-26) has no `synced`
field, so the copy uploads on its own as a normal insert.

Line 64 collects written ids into `changed`; returning `[]` at line 53 means that
set stays clean for unchanged records.

### `readRemote` (lines 67-72)

A targeted `select('*')` for one `(user_id, id)`. Its only caller is `pushNote`'s
conflict recovery, where it fetches the exact server revision that beat the
optimistic write so the retry can be conditioned on it.

### `pushNote` (lines 74-111)

Up to three attempts, and the note is re-read from IndexedDB at the top of *each*
attempt (line 76) — that re-read is what lets attempt 2 see whatever
`mergeRemote` wrote during attempt 1.

- Line 77: if the note vanished or is no longer dirty, return. This is how a note
  gets dropped from the work queue after a concurrent merge.
- Lines 84-90 choose the write by whether a baseline exists:
  - With a baseline (`snapshot.synced` set): a conditional `update` carrying
    `.eq('server_updated_at', snapshot.synced.serverUpdatedAt)`. The row is
    replaced only if it is still the revision we based our edit on.
  - Without one: an `insert`. A pre-sync-era note that was never uploaded arrives
    here.
- Line 92: only a non-23505 error is fatal. A unique violation (someone else
  inserted this id) is deliberately routed into the recovery path.
- Lines 93-103, success: write the new revision back with
  `updateNotes`, setting `dirty: !sameContent(current, row)`. Subtle: the
  comparison happens *inside* the write transaction against the current record,
  not against the snapshot read at line 76. If the user typed during the network
  round trip, the note stays dirty instead of being marked synced against content
  that was never uploaded.
- Lines 107-109, failure: fetch the winning server row and merge it (preserving
  its content, backing it up if it conflicts), then retry the loop.

Subtle and worth calling out: **exhausting all three attempts is not an error.**
The loop simply ends and `pushNote` returns normally. The note stays dirty, which
`hasDirtyNotes()` at line 188 reports as `'pending'`, which schedules `syncSoon()`
at line 190. Retry is therefore delegated to the pending check rather than signalled
as a failure.

### `sync` (lines 113-199)

Line 114 is the gate: no Supabase client (build configured without one), or a run
already in flight, means return immediately. Line 116 sets `running = true`
*before* any `await`, which the comment at 115 flags as necessary — otherwise two
calls in the same tick would both pass the check.

Preflight, in order:

- Line 124-127: offline → report `'offline'` and return without touching the network.
- Line 128: `await beforeSyncListener?.()` — `main.ts` wires this to `saveNow()`
  and throws if local edits cannot be persisted. Syncing before flushing would
  otherwise race the local save.
- Lines 129-135: fetch the session; no user → report `'local'` (local-only mode)
  and return.
- Line 136: report `'syncing'`.

**Pull phase (141-175).** Line 141 loads `getSyncRevisions()` — a `Map<id,
serverUpdatedAt | null>` read from the `syncMetadata` store — once, before the scan.

Then the metadata loop pages *all* rows by primary key:

```ts
supabase.from('notes').select('id,server_updated_at').eq('user_id', userId)
  .order('id', { ascending: true }).limit(PAGE_SIZE)
```

with `.gt('id', afterId)` for pages after the first (146). The comment at 138-140
states the tradeoff directly: **no timestamp watermark**. ID pagination keeps
tombstone discovery and correctness under tied timestamps, server row caps, and
concurrent writes, at the cost of listing every row's metadata on every run.

Line 151-154 filters the page to ids whose `server_updated_at` differs from the
snapshot (a note never synced locally is absent from the map, so `undefined !== string`
and its body is downloaded). Bodies are then fetched with `select('*')` in a nested
ID-paginated loop (156-169) and merged one at a time (165).

Two non-obvious details:

- Line 174's comment, "Continue even for a short page", means the loop terminates
  only on a genuinely empty page, not on `length < PAGE_SIZE`. A short page can just
  mean the server caps below 200.
- Lines 167 and 172 both throw `'Sync pagination did not advance.'` if the last id
  of a page equals the previous cursor. Without that, a server that silently caps
  below the requested `limit` in a way that returns the same row would loop
  forever.
- `revisions` is a snapshot from line 141 and is never refreshed, so a row changed
  by another device mid-scan is compared against the pre-scan baseline. Worst case
  it is re-merged next run.

Line 176 flushes the merge results to `onAfterMerge` before pushing, so the UI
reflects pulled changes without waiting on uploads.

**Push phase (178-190).** `getDirtyNotes()` takes a snapshot of dirty ids, and up
to four workers drain it through a shared `next` counter:

```ts
const uploads = await Promise.allSettled(
  Array.from({ length: Math.min(4, dirty.length) }, async () => {
    while (next < dirty.length) await pushNote(dirty[next++].id, userId, changed);
  }));
```

The comment at 180-181 explains `allSettled`: every worker is allowed to finish
before `running` is released, so no upload can outlive the single-flight lock or
the failure refresh. `Promise.all` would return on the first rejection and leave the
other three uploads in flight with nobody waiting on them. Line 185-186 rethrows
the *first* rejection after all workers have settled.

Note the counter is incremented synchronously before the `await`, so two workers
never take the same index.

Line 187 flushes changes again; line 188 re-reads `hasDirtyNotes()` after the push
and reports `'pending'` or `'synced'`, scheduling another `syncSoon()` when notes
remain (190). Notes dirtied *during* the push phase were never in the `dirty`
snapshot, and this is what catches them.

**Failure handling (191-198).** The catch logs, reports `'error'`, and then
retries `notifyChanges()` inside its own try/catch (195) so merges already committed
before the failing request still reach the UI. The `finally` releases `running`.

Subtle: `notifyChanges` (118-122) awaits `afterMergeListener` *before* calling
`changed.clear()`. If the listener throws, the set is left populated and the
catch-block retry genuinely re-notifies; if it succeeded, the second call is a
no-op. That ordering is what makes line 195 work.

### `syncSoon` and module triggers (lines 201-217)

`syncSoon` is a plain 3-second debounce: `clearTimeout` then `setTimeout`, nulling
`editTimer` inside the callback so a later call is not blocked by a fired timer.
`main.ts` calls it on note save and at startup.

Module side-effects wire four more triggers: a 30-second interval that syncs only
while `document.visibilityState === 'visible'` (210-212), the same check on
`visibilitychange` (213-215), `online` → `sync()` (216), and `offline` → report
`'offline'` without calling `sync` (217), since `sync` would immediately bail at
line 124 anyway.

## Gotchas

- Every trigger is **dropped, not queued**. `sync()` returns immediately while
  `running` is true (114), so a keystroke, visibility change, or `online` event that
  lands mid-run does nothing. The 30-second interval is the backstop.
- The pull phase lists `id, server_updated_at` for **every** row of the user on
  every run, even when nothing changed anywhere: `n / 200` round trips every 30
  seconds. That is the deliberate price of not using a watermark (138-140).
- `beforeSyncListener` failing aborts the whole run before any network call, and
  is reported as `'error'` — so an IndexedDB write problem surfaces as a sync
  error.
- `syncSoon()` at line 190 is scheduled while `running` is still `true` (the
  `finally` has not run). It only works because the 3-second delay outlives the
  `finally`; a shorter delay would silently no-op at line 114.
- `pushNote` treats three failed attempts as success (falls out of the loop). The
  only signal is `hasDirtyNotes()` → `'pending'` → `syncSoon()`. There is no backoff
  on that path, so a permanently conflicting note retries every 3 seconds
  indefinitely.
- `conflictCopy` has no `synced` field, so every conflict backup is created dirty
  and uploads as an insert on the next push — a losing side that always uploads.
- A conflict (line 62) leaves the local note dirty with the *remote* revision as
  its new baseline, so the next push overwrites the server unconditionally from
  that point. The remote text survives only in the conflict copy.
- `mergeRemote` returns `[]` for an unchanged revision (53). Nothing is written and
  nothing is added to `changed`, so callers that assume "merge always notifies"
  will miss UI refreshes.
- The metadata scan compares against a `revisions` snapshot taken at line 141, not
  a live read. Rows mutated mid-scan are reconciled on the next run.
- `dirty` is snapshotted at line 178 before the workers start. Anything dirtied
  during the push phase is only handled by the `hasDirtyNotes()` check at 188.
- `changed` is a single `Set<string>` shared by the four upload workers and the
  sequential merge loop, and is only cleared inside `notifyChanges`. An id may
  therefore be reported as changed several times across the two `notifyChanges`
  calls in a run.
- `sameContent` deliberately ignores `updatedAt`, so a remote edit that only moves
  `updated_at` will not mark the local note dirty on the next push.
- Pagination loops throw rather than spin if a page fails to advance (167, 172);
  a server that ignores `.gt('id', ...)` surfaces as an explicit error, not a hang.
- `running` and the listener slots are module globals. A second `onSyncStatus` call
  silently replaces the first; there is no teardown.