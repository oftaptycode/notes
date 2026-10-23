# `src/markdown.ts`

Structural and hiding decorations for the note editor. It takes the Lezer Markdown
parse tree that `@codemirror/lang-markdown` (with `GFM` plus the app's custom
`Guillemets` extension) produces for the open note and turns it into CodeMirror
decoration ranges: heading/quote/code-block/list line classes, `«…»` marks, and
`Decoration.replace` ranges that hide the source punctuation (`#`, `>`, `*`, `` ` ``,
link destinations, link reference definitions) so a note reads like rendered
Markdown while remaining fully editable plain text. It is deliberately
incremental: on every keystroke it reuses the parse trees Lezer already reused,
maps the previous decoration sets through the transaction, and re-runs
`formatBlock` only on the blocks that actually changed.

**Depends on:** `@codemirror/language`, `@codemirror/state`, `@codemirror/view`, `@lezer/common`, `./mdHighlight`
**Used by:** `src/editor.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `HEADINGS` | 7-11 | Lezer node name → `md-h1`…`md-h6` line class, ATX and Setext |
| `HIDDEN_MARKERS` | 12-16 | Syntax-only tokens replaced with nothing |
| `LEADING_MARKERS` | 17 | Hidden tokens whose following space is swallowed too |
| `Formatting` | 19-24 | The state-field value: both decoration sets + parse cache |
| `LinkTarget` | 25-28 | A resolved link destination (url + title) |
| `Block` | 29-35 | One top-level parse tree plus its link-reference metadata |
| `referenceKey` | 37 | CommonMark label normalization (trim, collapse, upper-case) |
| `linkTarget` | 39-46 | Extract `URL` / `LinkTitle` children, stripping `<>` and quotes |
| `readBlock` | 48-66 | Walk a block tree once to harvest definitions and reference usage |
| `formatBlock` | 68-144 | Turn one block tree into mark/hidden ranges |
| `hide` (inner) | 75-77 | Push a `Decoration.replace({})` range |
| `lineStyle` (inner) | 78-87 | Class whole lines spanning a node range |
| `buildFormatting` | 146-258 | Incremental core: reuse, dirty marking, mapping, filtering |
| `addBlock` (inner) | 153-159 | Reuse a previous block by tree identity, else read it |
| `collect` (inner) | 163-173 | Flatten anonymous balancing groups into real blocks |
| `mergeRanges` (inner) | 201-210 | Sort + coalesce invalidation ranges into disjoint spans |
| `update` (inner) | 236-253 | Map the old set, drop invalid decorations, add the rebuilt ones |
| `markdownDecorations` | 262-273 | The `StateField` plus its two facet providers |
| `markdownFormatting` | 275 | Extension array consumed by `editor.ts` |

## Walkthrough

### `HEADINGS` / `HIDDEN_MARKERS` / `LEADING_MARKERS` (lines 7-17)

Three lookup tables drive the whole styling pass. `HEADINGS` covers both ATX
(`ATXHeading1`…`6`) and Setext (`SetextHeading1`/`2`) node names so a `Title\n=====`
heading gets the same `md-h1` class as `# Title`.

`HIDDEN_MARKERS` is deliberately *not* the full set of Markdown punctuation.
`ListMark` and `TaskMarker` are absent on purpose (see the comment at line 13):
keeping `- ` and `- [ ] ` visible means the caret stays in a list you can keep
typing in. Everything else — `HeaderMark`, `QuoteMark`, `EmphasisMark`,
`StrikethroughMark`, `CodeMark`, `CodeInfo`, `HorizontalRule` — is replaced with an
empty widget.

`LEADING_MARKERS` is the spacing fix-up. Hiding `#` but leaving the space after it
would indent the heading text by one character; so for `HeaderMark` and `QuoteMark`
only, line 100 also swallows a single following space if one is present.

Subtle: a Setext heading's underline is itself a `HeaderMark` in `@lezer/markdown`,
so it is hidden by the same rule — but the character after it is a newline, not a
space, so the line-100 lookahead does nothing.

### Data model (lines 19-35)

`Formatting` is what the `StateField` holds. Besides the two `DecorationSet`s it
carries `blocks` and `references`, which exist purely as the incremental cache:
`blocks` is the list of top-level `Tree`s with their positions and link metadata,
`references` is the document-wide resolved link-target map. Neither is rendered;
both are needed to decide what is dirty on the next keystroke.

`Block.referenceLinks` (line 34) is the "this block renders a reference link" flag.
It is the only trigger for cascading invalidation when the reference map changes,
so it must stay accurate or stale link decorations survive an edit elsewhere.

### `referenceKey` / `linkTarget` (lines 37-46)

`referenceKey` implements CommonMark's link label normalization: trim, collapse
internal whitespace runs to a single space, upper-case. Both the definition side
(line 55) and the use side (line 125) go through it, so `[Foo Bar]` and `[foo   bar]`
resolve to the same entry.

`linkTarget` reads a `URL` and a `LinkTitle` child off a link node and strips the
syntax: `.replace(/^<|>$/g, '')` removes angle brackets around a pointy-bracket
destination (line 43), and the `+ 1` / `- 1` on line 44 strip the surrounding
quotes from a `LinkTitle`. Missing children yield empty strings rather than
throwing, because Lezer only produces a `URL` when it actually parsed one.

### `readBlock` (lines 48-66)

Runs once per *new* block tree — never again while that exact `Tree` object is
reused — and harvests two things:

- Line 52-58: every `LinkReference` node (a block-level `[label]: url "title"`
  definition) contributes a `[normalizedKey, LinkTarget]` pair to
  `block.definitions`. A definition is a top-level node in its own right, so
  `block.tree` can *be* the `LinkReference` tree.
- Line 59-62: a `Link` node whose `LinkMark` children contain no `(` is a
  reference-style link, so the block sets `referenceLinks = true`. Checking the
  literal `(` (rather than a node name) is what distinguishes `[a](b)` from
  `[a][b]` and `[a]`.

### `formatBlock` (lines 68-144)

Single-block pass producing two arrays of ranges. All node offsets are block-local;
every push adds `block.from` back (lines 76, 79-80, 105, 136, 141).

`hide(from, to)` (75-77) guards `from < to` so zero-width tokens never become
empty `Decoration.replace` ranges, which CodeMirror rejects.

`lineStyle(from, to, cls)` (78-87) is the multi-line class helper. Two details:

- Line 81 uses `lineAt(Math.max(from, to - 1))` for the end line, so a node that
  ends exactly at a line start does not style the next line.
- Lines 82-86 accumulate classes into a `Map<lineStart, Set<string>>` rather than
  pushing one decoration per class, and line 141 joins them into a single
  `Decoration.line`. So a line that is simultaneously a heading and, say, a list
  item gets one decoration with `"md-h1 md-list"`, not two competing ones.

The structural hooks are all in the `tree.iterate` at 88-115: headings (91-92),
`Blockquote` (93), `FencedCode`/`CodeBlock` (94), `HorizontalRule` (95). `ListItem`
(96) is the odd one — it styles only from the item's start to the end of *that
line*, so `md-list` applies to the marker line and not to the wrapped continuation
lines.

Line 103-106 handles the app's `«…»` extension: `Guillemet` (the quoted span) gets
`gq-text`, `GuillemetMark` (the delimiters) gets `gq-mark`.

The link pass (117-138) is separate because it needs `references`, which is
document-wide, and it must run after the tree walk so the `links` array is complete.

- Line 121 `inline` is true when any `LinkMark` is exactly `(`. `@lezer/markdown`
  emits, for `[a](b)`: LinkMark `[`, LinkMark `]`, LinkMark `(`, `URL`,
  optional `LinkTitle`, LinkMark `)`.
- Line 124 `name` is the reference label if there is one, otherwise the visible
  link text — which is how bare `[text]` shortcut references resolve.
- Line 125 resolves an inline link from its own children and a reference link from
  the document-wide map.
- Line 129 is the important one. Lezer parses unresolved `[text]` and
  `[text][missing]` as `Link` nodes too. Those must render literally, so the
  function `continue`s and adds nothing — no `md-link` class, no `title`
  attribute, no hiding. The comment at 127-128 spells out that adding a wrapper
  here would produce an inert gray box.
- Line 131 hides `closing.from → link.to`, which for `[a](b "c")` swallows
  `](b "c")` and for `[a][b]` swallows `][b]`, leaving just the label visible.

Subtle: this is exactly the decoration the module comment at 260-261 is about —
`link.to` can be several lines past `closing.from` if the destination wraps.

### `buildFormatting` (lines 146-258)

This is the core. Signature `(state, previous?, transaction?)` — `previous` and
`transaction` are both undefined on the initial `create`.

**Step 1, block identity (146-179).** `oldBlocks` (149) keys previous blocks by
their `Tree` object. Lezer's incremental parser reuses the *same* `Tree` instance
for a top-level block whose text did not change, so `addBlock` (153-159) can do:

```ts
const block = old ? { ...old, from, to: from + tree.length } : readBlock(state, tree, from);
```

A reused block keeps its `definitions` and `referenceLinks` flags and skips
`readBlock` entirely. A new block is read and marked dirty.

`collect` (163-173) flattens **anonymous balancing groups** — Lezer's internal
nodes (`isAnonymous`) that exist to balance sibling counts in incremental parses.
They are not Markdown constructs and their `type`/`length` can change even when
every paragraph inside them is reused, so treating one as a block would invalidate
the whole group on any keystroke. Instead the walk descends into them and yields
the real named children. Because the offset is threaded through `collect`, the
resulting `from` values are absolute document positions.

Line 166 is a guard, not a stylistic choice: `Tree.children` is typed
`readonly (Tree | TreeBuffer)[]`, and a `TreeBuffer` (a not-yet-materialized
leaf group) has no `type` property. If one appears, `collect` returns `false` and
lines 174-179 fall back to iterating `tree.topNode` directly, calling `toTree()` to
force buffers to materialize. The comment at 162 notes Markdown blocks are normally
unbuffered, so this is a rarely-taken safety net.

**Step 2, reference map (180-189).** Definitions are folded in document order with
first-wins semantics (line 182), matching CommonMark. `changedReferences` (184-188)
compares the new map against `previous.references` — size mismatch catches
additions *and* removals, and the per-entry `url`/`title` comparison catches an
in-place edit of an existing definition.

If anything changed, line 189 dirties every block with `referenceLinks`. Blocks that
only *define* links are not dirtied: a definition renders as hidden text whose
appearance does not depend on the map.

**Step 3, invalidating vanished blocks (191-226).** For every previous block whose
tree was not reused, a range is pushed into `invalid`:

```ts
const lineFrom = (transaction?.startState ?? state).doc.lineAt(old.from).from;
const from = transaction ? transaction.changes.mapPos(lineFrom, 1) : lineFrom;
const to   = transaction ? transaction.changes.mapPos(old.to, -1)   : old.to;
```

Subtle: the line start is computed against `transaction.startState`, i.e. in *old*
coordinates, then mapped forward — that is why the old block's `from` can be fed to
`doc.lineAt` even though `old.from` is stale. Mapping `lineFrom` with assoc `1`
and `old.to` with assoc `-1` deliberately *widens* the range to swallow the seam,
so decorations adjacent to the edit are invalidated too rather than surviving with
a shifted position.

The comment at 194-195 explains why the range starts at the line start rather than
`old.from`: an indented heading or blockquote starts mid-line, but its
`Decoration.line` sits at column zero, so invalidating only `old.from` would leave
the stale line class behind. Line 199's `Math.min`/`Math.max` handles a fully
deleted block, whose two mapped positions can invert.

`mergeRanges` (201-210) sorts and coalesces into disjoint spans. `removed` (211) is
that list. Lines 214-226 then do something easy to miss: a deleted block's mapped
range frequently *collapses onto* the start of a surviving block (e.g. deleting
one paragraph in a two-paragraph note). Because the range is now a point sitting
inside a live block, that neighbor must be dirtied too — otherwise the filter would
delete its line decoration and nothing would re-add it. The loop at 215-226 is a
sweep over the sorted disjoint ranges testing each block for containment (219-221),
with `rangeIndex` advanced monotonically (216) since both lists are sorted.

**Step 4, rebuilding (227-258).** Line 227 appends, for each dirty block, a range
starting at `state.doc.lineAt(block.from).from` — the new-document line start — for
the same column-zero reason as step 3. All invalidation ranges are now in
*new-document* coordinates, which is what `DecorationSet.update` expects. Lines
230-234 re-run `formatBlock` for dirty blocks only and pool the results.

`update` (236-253) does the set surgery:

```ts
const mapped = (set) => transaction ? set.map(transaction.changes) : set;
```

Map first, then filter — the order matters, because the invalidation ranges were
computed by mapping the old positions forward.

If `ranges` is empty the set is just mapped (237), which is the common "nothing was
touched" path. Otherwise `filterFrom`/`filterTo` bound the span CodeMirror even
considers, and the `filter` callback (240-250) binary-searches for the last range
starting at or before the decoration, keeping the decoration when there is no such
range, when it starts strictly after `range.to`, or when it starts exactly at
`range.to` of a *non-empty* range (a zero-length range is a collapsed insertion
point, and a decoration sitting exactly there is dropped).

Subtle: the predicate compares only the decoration's *start*. A decoration that
begins before an overlapping invalidation range is kept, even if it extends into
it. In practice this is benign because decorations never span a top-level block
boundary, but it is a real asymmetry, not an oversight you can assume away.

`sort: true` (251) is required: newly added ranges from dirty blocks interleave
with kept ones rather than appending in order.

Finally lines 254-257 build the two sets. Note `decorations` gets
`[...marks, ...hidden]` while `hidden` gets only `hidden` — the replace
decorations are deliberately present in both sets, once for rendering and once
for cursor semantics.

### `markdownDecorations` (lines 260-273)

The comment at 260-261 is the design constraint, and it is load-bearing.
CodeMirror throws `RangeError("Decorations that replace line breaks may not be
specified via plugins")` for any decoration set that is a *function* of the view,
because those sets are resolved after the viewport is computed. A state field
whose value reaches the facet through `EditorView.decorations.from(field, get)`
delivers the `DecorationSet` **itself** (`Facet.from` compiles to
`compute([field], state => get(state.field(field)))`, so the slot value is the
resulting set, not the function) — which is why a state field *can* replace ranges
containing newlines and a view plugin cannot. Line 131's `hide(closing.from,
link.to)` is exactly such a range when a link destination wraps across lines.

`update` (264-268) rebuilds only when the document changed **or** the parse tree
object changed (`syntaxTree(startState) !== syntaxTree(state)`). The second
condition catches a lazy re-parse that happened without an edit. Selection-only
and annotation-only transactions return the previous value untouched.

`provide` (269-272) exports two things: `decorations` for rendering, and
`atomicRanges` backed by the `hidden` set, so a hidden link destination behaves as
one indivisible unit for cursor motion and deletion rather than something the
caret can be dropped into.

### `markdownFormatting` (line 275)

The two-element extension array `editor.ts` splices into its state: the shared
`mdHighlightStyle` for inline emphasis/code/heading text, plus this field. Note
that `mdHighlight.ts` deliberately contains *no* hiding rules — all structural
hiding lives here.

## Gotchas

- Reuse is keyed on `Tree` **object identity** (line 149), not on text or node
  ranges. Any change to how blocks are enumerated breaks reuse silently rather
  than loudly.
- `Block.referenceLinks` is the only path by which an edit in one block invalidates
  link decorations in another. If `readBlock` stops setting it, editing a
  definition will leave stale `md-link` titles and destinations everywhere.
- Anonymous groups are flattened (168-169) *and* buffers are rejected (166). Both
  are needed: the first keeps reuse granularity at paragraph level, the second
  keeps the walk from producing a `TreeBuffer` with no `type`.
- Invalidation ranges mix sources — old blocks mapped forward through the
  transaction (191-200) and new blocks read directly (227). Both end up in
  new-document coordinates only because of the `mapPos` calls; removing them would
  corrupt the `filter` binary search rather than throw.
- The deleted-block-collapses-onto-a-neighbor case (212-226) is the subtle one.
  Remove that sweep and deleting a line silently strips the surviving block's
  heading/list styling.
- `filterFrom`/`filterTo` (239) mean decorations entirely outside
  `[ranges[0].from, ranges[last].to]` are never passed to `filter`. Correct today
  because the ranges span every dirty block, but it means the bounds must keep
  covering all invalidation.
- Reference definitions are document-global and first-wins (182), so editing one
  definition invalidates every block that uses *any* reference link. The
  incremental path degrades to a full rebuild in that case.
- The filter compares a decoration's start only (240-250); a decoration that
  starts before an overlapping range is kept.
- `hide` on a top-level `LinkReference` (111) replaces the definition text but not
  its line, so each definition still occupies a blank line in the editor.
- `Decoration.replace` ranges are computed from the *old* set via `map`; they are
  not re-derived from the tree. If the tree reuses a block but the map moved a
  hidden range, it is the filter that must remove it.