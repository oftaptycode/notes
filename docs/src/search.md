# `src/search.ts`

The client-side half of the search subsystem and the only stateful part of it.
It owns a `SearchIndex` mirror on the main thread, lazily spawns
`search.worker.ts`, coalesces pending edits into one message, and degrades to
main-thread search if the worker cannot be created or errors. `list.ts` consumes
exactly this API: `reset` / `update` / `query` / `destroy`.

**Depends on:** `searchIndex.ts` (`SearchIndex`, `SearchItem`, `SearchMessage`, `SearchResult`), the Web Worker API
**Used by:** `list.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `createSearch` | 3-84 | Factory returning the search handle |
| `content` | 4 | Main-thread mirror: id → raw note body |
| `worker` / `fallback` / `started` | 5-7 | Transport state, exactly one of worker/fallback is live |
| `request` | 8 | Monotonic correlation counter for query responses |
| `pending` | 9 | request id → `{ query, resolve }` |
| `changes` | 10 | id → new content, coalesced until the next query |
| `items()` | 11 | Flattens `content` into a `SearchItem[]` payload |
| `send()` | 12 | Non-null-asserted `postMessage` |
| `useFallback` | 14-22 | Kill the worker, resolve everything inline |
| `start` | 24-38 | Lazily construct the worker, or fall back |
| `reset` | 41-47 | Wholesale corpus replacement |
| `update` | 48-59 | Incremental corpus change with diffing and coalescing |
| `query` | 60-75 | Returns a promise of matching ids |
| `destroy` | 76-82 | Terminate, settle pending with `[]`, clear state |

## Walkthrough

### State and mirroring (lines 4-12)

`content` (line 4) is a full mirror of the corpus held on the main thread even
though the matching happens in the worker. It exists for two reasons: it is what
`useFallback` rebuilds the inline index from (line 18), and it is the
authoritative copy for the diff in `update`.

`changes` (line 10) is the interesting one. `update` is called on every
keystroke-save, but the worker is not told anything yet — line 57 only records
the new content. The comment on lines 55-56 explains why: pushing a full note
body through `postMessage` on every keystroke would structured-clone hundreds of
KB per character when nobody is searching. The payload is flushed lazily, and
only immediately before a query (lines 67-70), which is the first moment the
staleness could be observable.

### `start` (lines 24-38)

Called only from `query` (line 61), so a user who never searches never pays for a
worker or a full corpus transfer. Line 36 sends the whole corpus at that moment,
which is why `reset()` before the first query needs no message (line 45 guards on
`if (worker)`).

Two failure paths: a thrown `Worker` constructor (line 27-28, e.g. a bundler that
cannot resolve the URL) is caught at line 37; an async failure inside the worker
is caught by the `error` listener at line 35. Both land in `useFallback`.
`started` is set before the try, so a failed start is not retried — the inline
index is good enough and trying again per keystroke would be worse.

### `useFallback` (lines 14-22)

Terminates the worker, builds a fresh `SearchIndex` from `content`, and — the
part that matters — drains `pending` by resolving each job against the inline
index (line 20). Without that drain, every in-flight `query` promise would hang
forever, and `list.ts`'s `scheduleFilter` would stall with a stale filter.

`changes.clear()` on line 19 is safe here because the new inline index is built
from `content`, which already reflects every change.

### `reset` (lines 41-47)

Clears and refills `content` (lines 42-44), skipping `null` contents since a null
content means "no such note". Lines 45-46 forward to both transports. Subtle
asymmetry: the local mirror drops nulls but the forwarded payload passes the
original array through, including nulls. That is harmless because
`SearchIndex.update` treats null as a delete and the map was already cleared.

This is the O(corpus) path — `list.setItems` calls it on every full reload.

### `update` (lines 48-59)

Lines 49-50 diff against the mirror: a null content counts as a change only if
the id is currently present, and a real content counts as a change only if it
differs. Unchanged notes are not forwarded at all, so a repeated save of
identical text is nearly free.

Line 57 does the coalescing into `changes` (last write per id wins). Line 58
applies the same changes to the inline index immediately — the fallback must
never be behind the worker.

### `query` (lines 60-75)

- Line 61 starts the worker if needed.
- Line 62 short-circuits to a synchronously-resolved promise when `fallback` is
  live. Note this branch is reached only after `start()`, because `start()` may
  itself install the fallback.
- Line 63 allocates the correlation id; line 65 registers the pending job
  **before** posting, so a worker that answers synchronously-ish can never beat
  the registration.
- Lines 67-70 flush coalesced changes and then the query, in that order.
  Ordering is load-bearing: a query sent before an `update` would miss it.
- Line 73's catch handles a worker that died between the last message and this
  one; `useFallback` then settles this very promise from the inline index via the
  `pending` drain.

There is no timeout and no cancellation. A worker that goes silent without firing
`error` leaves the promise unresolved.

### `destroy` (lines 76-82)

Terminates the worker and settles every pending job with an empty array (line
78). This is safe only because `list.ts` bumps its own filter version in
`destroy()` and discards stale responses.

## Gotchas

- `query()` never rejects. Every failure path degrades to the inline index or to
  `[]`, so callers cannot distinguish "no matches" from "search is broken".
- `content` is the source of truth for fallback rebuilds. If `update()` is ever
  bypassed (e.g. mutating a note and calling `query` without `update`), the
  worker and the fallback will disagree.
- The `worker!` assertion in `send` (line 12) is only safe because every call site
  is guarded by `if (worker)` or by having just returned from the `fallback`
  branch.
- `reset` is a full corpus transfer. On a large library this structured-clone is
  the most expensive thing in the search path; `update` exists to avoid it.