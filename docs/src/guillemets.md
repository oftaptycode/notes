# `src/guillemets.ts`

A Lezer Markdown extension that adds French guillemets as a first-class
inline construct: `«text»` parses into its own node type instead of being
plain text. It exists so the Markdown formatter in `src/markdown.ts` can give
quoted text a real class (`gq-text` / `gq-mark`) rather than leaving it as
unstyled characters.

**Depends on:** `@lezer/markdown` (type-only)
**Used by:** `src/editor.ts`, and node names consumed by `src/markdown.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `GuillemetDelim` | 4 | Shared delimiter descriptor (resolve/mark node names) |
| `Guillemets` | 6-23 | The exported `MarkdownConfig` |

## Walkthrough

### `GuillemetDelim` (line 4)

A two-field object naming both nodes produced by a delimiter pair:
`resolve: 'Guillemet'` for the content between the marks and
`mark: 'GuillemetMark'` for the `«` / `»` characters themselves. Both node
names are declared in `defineNodes` (line 7) and both are consumed downstream
by `src/markdown.ts:103-106`, which adds a mark decoration per node — the
inner text as `gq-text` and the punctuation as `gq-mark`.

### `parseInline` (lines 8-22)

- The parser matches on the raw code point: `next === 171` for `«` (line 12)
  and `next === 187` for `»` (line 15). Both are compared numerically rather
  than as the literal characters, with the character given in a trailing
  comment (lines 12, 15) — the numeric form is what the Lezer `ParserContext`
  hands the callback.
- Line 13 opens a delimiter (`fromOpen = true`, `fromClose = false`); line 16
  closes it (`false`, `true`). Each spans exactly one character
  (`pos, pos + 1`).
- Line 18 returns `-1` for anything else, which is how a `ParserContext` parse
  function declines a character.
- `after: 'Emphasis'` (line 20) sets the parse priority: this rule is tried
  after the standard emphasis rule, so the common `*`/`_` cases keep their
  existing precedence and guillemets only get considered when emphasis did not
  match. GFM is registered alongside this extension in
  `src/editor.ts:31`, so strikethrough parsing interacts with the same
  inline pass.
- No `defineNodes` marks the content as anything semantically meaningful — the
  nodes are purely a styling hook.

## Gotchas

- Unclosed `«` simply does not produce a `Guillemet` node; there is no fallback
  or error path, and the text renders unstyled.
- Nesting is not handled by this extension — it relies on Lezer's generic
  delimiter resolution.
- Renaming `Guillemet` or `GuillemetMark` here silently breaks
  `src/markdown.ts:103-106`, which matches those names by string.
