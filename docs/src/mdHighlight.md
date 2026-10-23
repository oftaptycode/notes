# `src/mdHighlight.ts`

The inline text-colour and typography half of the Markdown styling system: a
CodeMirror `HighlightStyle` covering headings, emphasis, strong, strikethrough,
inline code and quotes. It is consumed by `markdownFormatting` in
`src/markdown.ts:275`, which pairs it with the decoration field that hides
Markdown syntax markers.

**Depends on:** `@lezer/highlight`, `@codemirror/language`
**Used by:** `src/markdown.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `mdHighlightStyle` | 5-17 | `HighlightStyle` with 11 inline tag rules |

## Walkthrough

### Rules (lines 5-17)

- The header comment (line 4) states the division of labour with
  `src/markdown.ts`: this file is **inline text styles only**; syntax hiding
  (`#`, `*`, backticks) and structural/block styling (list lines, code-block
  lines, horizontal rules) are handled by the decoration field there. So the
  two files never overlap.
- Headings (lines 6-11) use `fontWeight` only, stepping down from `700` for
  h1/h2 to `600` for h3-h6. They deliberately do not set size or colour: the
  `md-h1`…`md-h6` *line* classes applied by `markdown.ts` own the block-level
  look, so the two layers compose instead of fighting.
- `tags.emphasis` → italic (line 12) and `tags.strong` → `700` (line 13) are the
  standard inline marks.
- `tags.strikethrough` (line 14) combines `line-through` with
  `color: var(--muted)`, so a GFM `~~struck~~` reads as de-emphasised rather
  than merely struck.
- `tags.monospace` (line 15) is the one rule with a full box treatment —
  `fontFamily: var(--mono)`, a smaller size, `--code-fg` / `--code-bg` colours,
  plus `borderRadius` and `padding`. That padding is what lets inline code
  visibly differ from a `md-codeblock` line, which gets its background from
  the block classes instead.
- `tags.quote` (line 16) reuses `--muted`, consistent with strikethrough; the
  surrounding `>` gutter is styled separately by the `md-quote` line class in
  `markdown.ts`.

### Colour handling

- Every colour is a `var(--…)` reference, never a literal. The app owns the
  palette in CSS; this module only says *which* token applies where. That also
  means these rules follow the ambient theme automatically.

## Gotchas

- Values like `fontSize: '0.88em'` and `padding` are emitted by CodeMirror as
  inline styles on generated spans; they can be overridden by later CSS but
  not by stylesheet rules of equal specificity.
- `HighlightStyle.define` order matters: later rules for the same tag win, so
  overlapping tags (strong inside a heading, for example) resolve to the last
  matching declaration rather than being merged.
- Nothing here hides anything. If a Markdown marker is visible, the fix belongs
  in `src/markdown.ts` (`HIDDEN_MARKERS`), not in this file.
