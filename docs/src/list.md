# `src/list.ts`

The virtualized note grid on the left pane. It owns the DOM for the card list, an
`updatedAt`-ordered in-memory array of notes, the search filter pipeline, and the
`ListHandle` API that `main.ts` drives from its write queue and sync callbacks.
Filtering is delegated to `search.ts`, which answers with an id set; this module
decides how to apply it without tearing or flashing.

**Depends on:** `types.ts` (`titleFromContent`, `Note`), `dates.ts` (`formatCreatedAt`), `search.ts` (`createSearch`)
**Used by:** `main.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `CARD_H` / `GAP` / `COLS_MIN_WIDTH` | 5-7 | Fixed geometry constants driving the virtualization math |
| `ListHandle` | 9-17 | Public API returned by `createList` |
| `createList` | 19-240 | Builds the handle and wires up listeners |
| `cols()` | 39-41 | Responsive column count, minimum 2 |
| `layout()` | 43-50 | Sets spacer height, clamps scroll, renders |
| `scheduleFilter()` | 52-74 | Debounced, versioned filter application |
| `scheduleRender()` | 76-83 | Coalesces renders into one animation frame |
| `cardFor()` | 85-122 | Builds or updates a single card element, with memoization |
| `render()` | 124-156 | Builds the visible row window and swaps it in |
| `open()` | 158-166 | Delegated click/keyboard activation |
| `setItems` | 175-179 | Wholesale replace, resets the search index |
| `upsertItems` | 180-201 | Sorted insert/update/delete from the save path |
| `refreshRow` | 202-210 | Jump a note to the top (newest) |
| `setActive` | 211-217 | Highlight the open note without a re-render |
| `setQuery` | 218-226 | Debounced search input |
| `getActiveId` | 227 | Current selection |
| `destroy` | 228-238 | Tear down listeners, observer, rAF, worker |

## Walkthrough

### Geometry (lines 5-7, 39-50)

Rows are a fixed `CARD_H + GAP` tall, and column count is
`max(2, floor(width / 340) + 1)` (line 40). The `+ 1` gives a slightly denser
grid than a strict 340px-per-column fit, and the `max(2, ...)` guarantees at
least two columns even on a phone-width pane.

`layout()` computes the total holder height, clamps `scrollTop` when the content
shrinks (line 47 — otherwise the viewport would sit past the end of a shortened
list), then sizes the spacer and renders. `layout()` is only ever reached through
`scheduleRender`, so every path is one frame behind the data change.

### `scheduleFilter` (lines 52-74)

Three layers of dedup over the same problem:

- `filterQueued` + `queueMicrotask` (lines 56-58) collapses a burst of
  `scheduleFilter` calls in one task into a single pass.
- `filterVersion` (lines 54, 68) discards responses that arrive after a newer
  request was issued. The captured `version` is compared on the `then` side, so
  out-of-order worker replies cannot resurrect stale results.
- Line 61 short-circuits the unfiltered case: `matched = null` and
  `filtered = items` with no worker round-trip at all.

Note that `filtered = items` (line 63) makes `filtered` **alias** the same array
object as `items`, which is exactly what makes the in-place `splice` calls in
`upsertItems` visible without reassignment. Elsewhere `filtered` is always
assigned a fresh array.

### `scheduleRender` (lines 76-83)

A single-rAF throttle. Everything that changes the view — scroll (line 169),
`ResizeObserver` (line 172), filter results, item updates — funnels through here,
so at most one layout+render per frame.

### `cardFor` (lines 85-122)

Builds the card once and keeps it in the `cards` map keyed by note id (line 37),
then applies only what changed:

- `active` class and `aria-pressed` are re-applied on every call (lines 103-104),
  because `setActive` and `render` can race on which one touches a given card.
- Preview text and `aria-label` are guarded by `cached.content !== n.content`
  (line 105). Line 108 caps the text pushed into the DOM at 1200 characters
  *before* splitting into lines; the comment on line 107 explains why that is in
  addition to the 6-line cap — six lines of a pasted paragraph can still be
  enormous. The ellipsis on line 111 fires if either cap hit.
- The `<time>` element is guarded by `cached.createdAt !== n.createdAt` (line
  114). Subtle: the initial sentinel is `NaN` (line 99), and `NaN !== NaN` is
  always true, so the first render of a card always populates the time. Line 118
  writes `dateTime` as the empty string for a non-finite timestamp, which makes
  the element drop out of `datetime` semantics rather than emit `"Invalid Date"`.

### `render` (lines 124-156)

Computes the row window: one row of overscan above (`- 1`, line 126), a row count
of viewport rows + 2 (line 127), and clamps the end to the last row (line 128).
The `+1`/`+2` margin is what keeps fast scrolling from showing blank bands
before the next frame lands.

Lines 130-134 are a fast path. The key encodes column count, start row, and the
visible ids; if nothing changed, the existing DOM is already correct and only
the per-card updates from `cardFor` are replayed.

On a real change:

- Line 136-137 snapshots the focused card's id **before** `replaceChildren`,
  because the swap would otherwise drop focus to `<body>`.
- Line 138 positions `rowsEl` with a transform rather than setting top offsets,
  so scrolling does not trigger layout of the offscreen region.
- Lines 153-154 prune the `cards` map to exactly the visible set. This is what
  bounds memory: cards scrolled out of view are dropped from both the DOM and the
  cache, and rebuilt from scratch on the way back. It also means `cardFor`'s
  memoization is only ever a per-window win, never a persistent one.
- Line 155 restores focus with `preventScroll: true`, which is required —
  otherwise focusing the restored card fights the scroll position that produced
  the window in the first place.

### `open` and listeners (lines 158-172)

A single delegated handler serves both `click` and `keydown` (lines 167-168).
Cards are `role="button"` with `tabIndex = 0` (lines 91-92), so Enter and Space
activate them (line 162); Space's default scroll is suppressed on line 163.
Because the handler is on the container and cards are recycled, no per-card
listeners are ever attached.

### `upsertItems` (lines 180-201)

The hot path from `main.ts`'s save queue. Each note is removed if present (183),
skipped if deleted (184), then re-inserted by a binary search on `updatedAt`
descending (185-191). `>>> 1` instead of `/ 2` on line 187 is a micro-optimization
for a hot loop.

Lines 194-198 implement the invariant spelled out in the comment on lines 195-196:
while a query is active, the last known result set is re-applied immediately
before the (async) refilter runs. Because `matched` is a `Set` that cannot
contain deleted ids and only ids from the newest completed query, a deleted note
or a stale worker response cannot flash back into the list.

Line 197 has a consequence worth knowing: if `query` is non-empty but `matched` is
still `null` (query typed, first result not yet returned), `matched?.has(...)` is
`undefined` for every note and `filtered` becomes `[]`. The list goes empty until
the worker answers.

### `refreshRow` (lines 202-210)

Moves a note to the front of `items` (lines 203-207) so a just-created note is
visible, then recomputes `filtered` and renders. Line 204's `idx > 0` is
correct-by-accidental: index 0 is already at the top.

### `setQuery` (lines 218-226)

Normalizes with `trim().toLowerCase()` (line 219) — matching what
`SearchIndex.query` normalizes anyway, so the guard on line 220 is stable. The
80ms debounce (line 225) applies only when the query becomes non-empty;
clearing the query filters immediately (line 224), because showing everything
back is cheap and users expect it instant. Line 222 bumps `filterVersion` before
the debounce so an in-flight response for the old query is discarded even during
the debounce window.

### `destroy` (lines 228-238)

Sets `destroyed`, bumps `filterVersion` (line 230) so any in-flight
`search.query` resolution is dropped by `scheduleFilter`'s version check, clears
the debounce timer, cancels a pending frame, disconnects the observer, removes
all three listeners, and destroys the search handle.

## Gotchas

- `filtered` and `items` are frequently the same array object (lines 63, 198).
  Never mutate `filtered` in place, and remember `setItems` replaces `items` with
  a new array (line 176) so any alias is stale until `filtered` is reassigned.
- `scheduleFilter`'s `.then` callback checks `filterVersion` but **not**
  `destroyed` — the post-await bail-out at line 59 only covers the synchronous
  path. The `filterVersion++` in `destroy` (line 230) is what actually makes the
  late path safe.
- `render()`'s fast path (lines 131-134) skips the `cards` map prune, so the map
  can transiently hold ids that are no longer visible. The next real window
  change cleans them up; only unbounded churn inside a single unchanged window
  would leak, which cannot happen because the key encodes the visible ids.
- `refreshRow` (line 208) guards on `matched` rather than on `query` the way
  `upsertItems` does (line 194). During the window where a query is typed but no
  result has returned yet, `refreshRow` will show **all** notes while
  `upsertItems` would show none. The two paths disagree in that one interval.
- `open` reads `card.dataset.noteId` off the event target, not off the
  `cards` cache. Cards removed from the map are also removed from the DOM in the
  same `render`, so the two cannot diverge in practice.
- `CARD_H`, `GAP`, and `COLS_MIN_WIDTH` are duplicated knowledge shared with
  `style.css` (`.grid-row` height, card min-width). Changing one without the
  other silently breaks the scrollbar-to-window mapping.
- `search.query` can never reject, but it can hang if the worker dies without an
  `error` event. There is no timeout anywhere in this pipeline, and
  `scheduleFilter` would leave the previous `filtered` in place indefinitely.