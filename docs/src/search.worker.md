# `src/search.worker.ts`

The worker-thread half of the search subsystem: eleven lines that own a single
`SearchIndex` and translate `postMessage` traffic into index mutations and
queries. Its entire job is to keep the O(corpus) substring scan of
`searchIndex.ts` off the main thread so typing in the search box never competes
with CodeMirror for frame time.

**Depends on:** `searchIndex.ts` (`SearchIndex`, `SearchMessage`, `SearchResult`)
**Used by:** `search.ts` (instantiates it via `new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })`)

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `index` | 3 | The worker-private `SearchIndex`, alive for the worker's lifetime |
| `message` handler | 4-11 | Dispatch `query` / `reset` / `update` and post results back |

## Walkthrough

### Message loop (lines 4-11)

One `addEventListener` with a manual if/else chain rather than a switch:

- Lines 6-8 handle `query`: run `index.query(message.query)` synchronously and
  post back `{ request, ids }`. The `request` field is echoed verbatim (line 7)
  so `search.ts` can settle the right pending promise. There is no cancellation:
  superseded queries are still executed and their results are still returned.
- Line 9 handles `reset` by handing the whole payload to `index.reset`.
- Line 10 is the `else`, which catches `update` — and anything else.

Subtle: line 10 is not an `else if (message.type === 'update')`. The
`SearchMessage` union is never narrowed exhaustively here, so an unrecognized
message type falls into `index.update(message.items)` with a possibly `undefined`
payload. That throws inside the worker, which surfaces as an `error` event on the
main-thread `Worker` — which `search.ts` treats as a signal to fall back to
main-thread search. So the loose dispatch degrades gracefully instead of hanging,
but only by accident of the failure mode.

There is no `try`/`catch` around the handler and no `self.close()`. An exception
inside `index.query` therefore does the same thing: the worker dies noisily, the
main thread sees `error`, and `useFallback` takes over. The worker also lives for
the whole page lifetime unless the main thread terminates it.

## Gotchas

- This module is bundled as a separate chunk by Vite via the `new URL(..., import.meta.url)`
  form in `search.ts`. Renaming the file without updating that URL silently drops
  worker construction into the `catch` in `search.ts`, which falls back to
  main-thread search — correct, but slower.
- The worker assumes it receives messages in order and that `reset` fully replaces
  its state. It keeps no copy of the corpus itself, so if `search.ts` fails to send
  the initial `reset` (line 36 of `search.ts`, sent at first query time), the
  worker answers every query with an empty id list.
- Imports are relative to `searchIndex.ts`, which is bundled into the worker
  chunk too. `searchIndex.ts` must stay free of DOM and `import.meta.env` access.