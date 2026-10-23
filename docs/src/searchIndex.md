# `src/searchIndex.ts`

The actual text-matching engine — a `Map` of id to lowercased note body, scanned
linearly with `String.includes`. It holds no UI state and knows nothing about
workers; the same class is instantiated inside `search.worker.ts` on the worker
thread and again on the main thread by `search.ts` as a fallback, which is what
makes the worker layer swappable.

**Depends on:** nothing
**Used by:** `search.ts`, `search.worker.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `SearchItem` | 1 | `{ id, content }`; `content: null` means "remove this id" |
| `SearchIndex.text` | 6 | id → lowercased body |
| `SearchIndex.reset` | 8-11 | Clear, then apply as updates |
| `SearchIndex.update` | 13-18 | Upsert or delete by id |
| `SearchIndex.query` | 20-25 | Substring scan, returns matching ids |
| `SearchMessage` | 28-30 | Worker protocol: `reset` \| `update` \| `query` |
| `SearchResult` | 31 | `{ request, ids }` echoed back to the caller |

## Walkthrough

### `SearchIndex` (lines 5-26)

`update` (lines 13-18) is the only place normalization happens: `toLowerCase()` on
line 16, once per *changed* note. The comment on lines 3-4 calls this out — a
query is matched against already-lowercased text, so typing another character
into the search box does no per-character work over the corpus.

`content: null` is a tombstone meaning "this id no longer exists in the corpus"
(lines 15, and symmetrically in `reset`). It is not an empty note: an empty note
still has content (`''`) and should be findable by an empty query. Note that
`''` is stored as `''`, so `text.includes('')` is true and an empty query matches
everything — `search.ts` and `list.ts` both guard against sending one.

`query` (lines 20-25) normalizes only the query (line 21), then linearly scans
insertion order. Results come back in whatever order `Map` iteration yields —
not ranked and not sorted. `list.ts` compensates by intersecting the returned id
set with its own `updatedAt`-ordered `items` array, so result order never leaks
into the UI.

This is O(total corpus size) per keystroke. That is why the whole thing sits
behind a worker (`search.ts` / `search.worker.ts`) rather than running inline.

### Worker protocol types (lines 28-31)

`SearchMessage` is the union the worker handler switches on. `request` on the
query message is a monotonically increasing correlation id so the main thread can
tell which promise to settle — the worker may finish out of order relative to
what was asked, and it makes no attempt to coalesce or cancel superseded queries.

## Gotchas

- `SearchIndex` is not a real inverted index; "index" here is just the
  normalized `Map`. Substring matching is case-insensitive but not token-based,
  diacritic-insensitive, or word-boundary-aware.
- `reset` delegates to `update` (lines 9-10) after `clear()`, so a `null` content
  in a reset payload is a redundant no-op rather than an error.
- Both `reset` and `update` mutate a shared `SearchIndex`. The class is
  single-threaded only because each thread owns its own instance; sharing one
  instance between the worker and main thread would not work.