# Design System — Notes

Reference for the visual language of the app. Everything below describes what
`src/style.css` and `src/mdHighlight.ts` currently implement.

Source of truth:
- `src/style.css` — all tokens, layout, components, motion
- `src/mdHighlight.ts` — inline Markdown text styles
- `src/noteBackground.ts` — the mood palette that drives `--lava-*`
- `index.html` — the fixed DOM the styles attach to

---

## 1. Principles

1. **Ink on a dark desk.** The app is a writing surface. Chrome recedes; the
   document is the brightest thing on screen.
2. **One accent, used sparingly.** Ink-blue `--accent` marks exactly three
   things: the caret, primary actions, and links. Nothing else.
3. **The document is lit from within.** The editor backdrop is a per-note,
   mood-derived field. It never sits behind the list.
4. **Raw Markdown is the data.** We paint *over* the source text. We never hide
   markers, never reformat, never insert characters.
5. **Flat by default, depth only for interruption.** Surfaces separate with a
   1px `--border`. Shadow is reserved for the modal layer, which must read as
   "you left the page".

---

## 2. Color

### 2.1 Token reference

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#13171a` | App canvas behind everything |
| `--surface` | `#181d21` | List pane, auth form inputs, dialog |
| `--card` | `#20272c` | Note card at rest |
| `--card-hover` | `#252e34` | Note card hover |
| `--fg` | `#e4e8e6` | Primary text, icons |
| `--muted` | `#8d989c` | Secondary text, dates, quotes |
| `--border` | `#262d32` | All 1px separators |
| `--marker` | `#6f7b80` | De-emphasised glyphs, hover borders |
| `--accent` | `#8fa9ee` | Caret, primary action, links, focus ring |
| `--accent-fg` | `#101418` | Text on accent fill |
| `--danger` | `#f0847b` | Destructive action |
| `--code-bg` | `rgba(143,169,238,.12)` | Inline + block code background |
| `--code-fg` | `#a9bdf2` | Inline code text |
| `--quote-bg` | `rgba(143,169,238,.06)` | Blockquote wash |
| `--quote-border` | `#3a4a73` | Blockquote rule |
| `--link` | `#8fa9ee` | Live links (same value as `--accent`) |
| `--highlight` | `rgba(240,208,70,.3)` | Text selection |
| `--row-hover` | `rgba(255,255,255,.04)` | Ghost button hover wash |

### 2.2 Surfaces

Three-step elevation, plus one overlay step:

```
--bg        app canvas
--surface   pane            (list, dialog)
--card      raised item     (note card)
--card-hover
```

The editor sits outside this ladder. `#editor-pane` is transparent and reveals
its own backdrop (see §6).

### 2.3 Contrast contract

- Body text and all controls: `--fg` on `--bg` / `--surface` / `--card`.
- Metadata, dates, probability lists: `--muted`, never lighter than that.
- `#editor-pane` raises `--muted` to `#9fa9ae`, and mobile raises it again to
  `#a5adb0`, because the mood backdrop darkens behind the text.
- Text on `--accent` fill always uses `--accent-fg`, never `--bg`.
- Text on `--danger` fill uses `#26100e`.

Do not introduce a fourth grey without extending the ladder and re-checking
contrast over the animated backdrop.

### 2.4 Hard-coded values that are not tokens

Deliberately local; do not promote them without a reason.

| Value | Where |
| --- | --- |
| `#080b0e` | Lava base fill and gradient shade source |
| `rgba(8,11,14,.78–.88)` | Lava shade veil (`--lava-shade-top/bottom`) |
| `#2e9e5b` | `#sync-dot[data-state="synced"]` |
| `#d9a520` | `#sync-dot[data-state="syncing"|"pending"]` |
| `rgba(240,132,123,.12)` | `.dialog-icon` wash |
| `#a9bdf2`, `rgba(240,208,70,.14)` | `.gq-text` |
| `#6f7b80` | `.gq-mark` |
| `%238c979c` | Search glyph stroke in the inline SVG |

### 2.5 Color-scheme

`color-scheme: dark` on `:root`. The app is dark-only; there is no light block
today. If one is added it belongs in
`@media (prefers-color-scheme: light)` and must redefine the same token names —
`mdHighlight.ts` resolves several of them through `var()`.

---

## 3. Typography

### 3.1 Families

| Token | Stack | Used for |
| --- | --- | --- |
| `--serif` | Charter, Bitstream Charter, Iowan Old Style, Sitka Text, Cambria, Georgia, serif | Document body, headings, blockquotes, `.gq-text` |
| `--sans` | system UI stack | All chrome, buttons, inputs, list cards |
| `--mono` | ui-monospace, SF Mono, Menlo, Consolas | Code blocks, inline code |

The reading face is a serif; the interface face is the platform's. That split is
the core typographic idea — prose feels like a document, controls feel like
tooling.

### 3.2 Scale

Base is `html { font-size: 16px }`. The editor runs at `.cm-editor { font-size:
15px }` and every Markdown size below is `em`-relative to it, so the whole
document scales from one declaration.

| Element | Size | Weight | Line-height | Extra |
| --- | --- | --- | --- | --- |
| H1 `md-h1` | `1.75em` | 700 | 1.25 | `letter-spacing: -.015em`, `padding-top: .5em` |
| H2 `md-h2` | `1.45em` | 700 | 1.3 | `letter-spacing: -.01em`, `padding-top: .4em` |
| H3 `md-h3` | `1.25em` | 600 | 1.35 | `padding-top: .3em` |
| H4 `md-h4` | `1.12em` | 600 | 1.4 | `padding-top: .2em` |
| H5 `md-h5` | `1.05em` | 600 | 1.4 | — |
| H6 `md-h6` | `1em` | 600 | 1.5 | `color: --muted` |
| Body | `1em` | 400 | 1.7 | justified, `inter-word` |
| Code block `md-codeblock` | `0.9em` | 400 | 1.7 | `text-align: left` |
| Inline code | `0.88em` | 400 | 1.7 | radius 4px, `padding: 1px 4px` |
| Chrome / buttons | `15px` | 500 | 1 | — |
| Metadata, `#save-state`, `#auth-bar` | `12px` | 400 | 1.4 | `--muted` |
| `#auth-bar` button | `13px` | 500 | 1 | `--accent` |
| `.card-created` | `11px` | 400 | 1.4 | `--muted` |
| `.card-preview` | `13.5px` | 400 | 1.45 | `--fg` |
| `#auth-error` | `13px` | 400 | 1.4 | `--danger` |
| `#note-mood-probabilities` | `11px` | 400 | 1.6 | `--muted` |
| Dialog `h2` | `22px` | 700 | 1.2 | `letter-spacing: -.02em` |

Rules: headings tighten as they grow; body copy loosens. Weight steps are
700 → 600 → 400, never 500 for text.

**Known drift:** the brief requires editor body text ≥ 16px; `.cm-editor` is
currently `15px`. Restore it before shipping.

### 3.3 Emphasis (from `mdHighlight.ts`)

- **Strong** — 700, same color as body.
- **Emphasis** — italic.
- **Strikethrough** — `line-through` in `--muted` (struck text should recede).
- **Monospace** — the inline-code recipe in §3.2.
- **Quote** — `--muted`, reinforced by the line-level `md-quote` wash.

Only inline text styling lives here. Structural styles (headings, rules, list
indentation) are line classes applied by `markdown.ts`.

---

## 4. Shape, Spacing, Depth

### 4.1 Radii

| Radius | Applied to |
| --- | --- |
| `3px` | `.gq-text` |
| `4px` | Inline code |
| `0 6px 6px 0` | `md-quote` (rounded on the open side only) |
| `10px` | Buttons, auth inputs |
| `12px` | `#auth-form` |
| `14px` | `.note-card`, `.dialog-icon` |
| `20px` | `#delete-dialog` |
| `22px` | `#search` (pill) |
| `50%` | `#new-note` (circle) |

Inner details are never rounder than their container. Pill and circle shapes are
reserved for the two inputs that read as "type here" and "start something new".

### 4.2 Spacing

Base unit is effectively 4px; the scale in use is 4 / 6 / 8 / 10 / 12 / 14 /
16 / 24.

```
#list-header        padding 12px          gap 8px
#auth-bar           padding 0 12px 6px    gap 8px
#auth-form          margin 0 12px 10px    padding 12px   gap 8px
.grid-row           padding 0 10px        gap 10px      margin-bottom 10px
#editor-header      padding 8px 12px      gap 4px
#note-footer        padding 0 24px 8px
#note-summary       padding 6px 0         gap 12px      min-height 44px
.cm-scroller        padding 16px 8px
.cm-content         padding 4px 16px 40dvh  (12px sides on mobile)
#delete-dialog form padding 24px         gap 10px      margin-top 24px
```

`40dvh` of trailing padding in `.cm-content` is deliberate: it lets the last
line of a note reach the vertical middle of the screen.

### 4.3 Depth

There is exactly one shadow in the system:

```css
#delete-dialog { box-shadow: 0 24px 80px rgba(0,0,0,.55); }
```

paired with a blurred backdrop (`rgba(0,0,0,.64)` + `blur(4px)`). All other
hierarchy comes from the surface ladder and 1px borders. If a second shadow is
ever needed it must be strictly shallower than this one.

---

## 5. Layout

```
#app         flex, 100vh with 100dvh override, overflow hidden at <html>
#list-pane   width 320px, min-width 260px, border-right 1px --border
#editor-pane flex 1, min-width 0
```

**Breakpoint: 800px.** At or above, both panes show side by side. Below, exactly
one pane shows and `body.note-open` decides which — `#back` becomes visible at
the same threshold. `#list-pane` drops its right border and takes full width.

The editor content column is capped at `44rem` and centred, so line length stays
readable on wide displays.

The card grid's dimensions are set in TypeScript, not CSS:
`CARD_H = 190`, `GAP = 10`, `COLS_MIN_WIDTH = 340` (`src/list.ts`). **Any change
to card padding, radius or grid gap must be mirrored in those constants**, or
virtual scrolling will desync from the rendered height.

---

## 6. The mood backdrop

The editor's background is three soft radial pools drifting over a near-black
base, crossfading to a new palette whenever mood detection resolves.

- `--lava-1` dominant emotion, `--lava-2` / `--lava-3` strong runners-up
- Neutral, missing, or not-yet-analysed notes fall back to the greys
  `#929aa5`, `#5e6875`, `#c2c7d0`
- `#editor-pane` sets `--lava-shade-top` (0.82) and `--lava-shade-bottom` (0.88);
  mobile lowers both to 0.78 / 0.86 because the phone has less room to breathe
- `--lava-*` are registered with `@property … syntax: '<color>'` so they can be
  transitioned; unregistered custom properties cannot animate

Pool geometry and timing:

| Pool | Size | Opacity | Duration | Delay |
| --- | --- | --- | --- | --- |
| one | 100% × 115% | 1 | 31s | -9s |
| two | 100% × 115% | 0.8 | 43s | -23s |
| three | 80% × 85% | 0.65 | 37s | -16s |

All `ease-in-out`, `alternate`, `infinite`. Negative start delays desynchronise
them so the field never visibly repeats.

**The backdrop is decorative.** `.note-lava` is `pointer-events: none`,
`aria-hidden="true"`, z-index 0; the header, editor and footer sit at z-index 1
inside an `isolation: isolate` pane. It must never intercept selection, scroll
or taps.

---

## 7. Components

### 7.1 Button

Baseline for every `button`:

```
min 44 × 44px      padding 8px 14px      radius 10px
transparent fill, 1px --border, --fg, 500/15px/1
transition: background-color .12s, border-color .12s
hover   background --row-hover, border --marker
active  opacity .7
focus   2px solid --accent outline, offset 1px
```

Variants:
- **Ghost** (`#editor-header` buttons) — transparent border, `--muted` text;
  border and text return to `--fg` on hover.
- **Primary** (`#new-note`) — `--accent` fill, `--accent-fg` text, circular,
  44 × 44, 24px SVG glyph. Hover dims to `opacity: .88` rather than lightening,
  so it stays the brightest object on the pane.
- **Danger** (`#delete-note`, `.dialog-actions .danger-button`) — `--danger`
  fill with `#26100e` text, `brightness(1.08)` on hover, `opacity: .45` and
  default cursor when disabled.
- **Link** (`#auth-bar button`, `#back`) — transparent border, `--accent` text.
- **Quiet** (`#auth-close`) — Cancel and other non-committal actions stay in the
  baseline ghost treatment. Never give a secondary action a filled surface.

### 7.2 Search field

44px tall pill, `--bg` fill, 1px `--border`, 14px left inset plus a 38px
padding-left reserved for an inline SVG magnifier (16px, 2px stroke, round
caps). `appearance: none` removes the native clear affordance. Placeholder is
`--muted`.

### 7.3 Note card

`.note-card` inside `.grid-row`.

```
flex 1 1 0, min-width 0, height 100%
padding 14px   radius 14px   1px --border   fill --card
flex column, gap 8px, overflow hidden
hover → --card-hover
```

Two children: `.card-preview` (flex 1, six-line clamp via `-webkit-line-clamp: 6`,
`pre-wrap`, `break-word`, capped at 1200 characters upstream) and
`.card-created` (flex none, 11px, `--muted`).

The whole card is unselectable (`user-select: none`, `-webkit-touch-callout:
none`) — it is a button, and `role="button"` / `tabIndex` / `aria-pressed` are
set in `list.ts`.

### 7.4 Auth form

A `--bg` panel inset 12px into the list, 12px padding, 1px `--border`, radius
12px, column stack with 8px gaps. Inputs are 44px, radius 10px, `--surface`
fill. The button row wraps. `#auth-error` is `--danger`, 13px, and reserves no
height so appearing text does not jump the layout.

### 7.5 Editor surface

- `.cm-scroller` — `--serif`, `line-height 1.7`, thin scrollbar
  (`--border` thumb on transparent track)
- `.cm-content` — `44rem` cap, centred, 16px sides, `40dvh` trailing pad
- `.cm-line` — `text-align: justify`, `text-justify: inter-word`. Justification
  applies to prose only; `md-codeblock` opts back into `left`
- Caret and drop cursor — `--accent`, 2px
- Selection — `--highlight`, forced with `!important` because CodeMirror's own
  rules win otherwise
- `focused` — no outline; the caret is the focus indicator

### 7.6 Markdown block styles

Applied as line classes; selectors are doubled (`.cm-editor .cm-line.md-*`) to
outrank CodeMirror's own `.cm-line` declarations.

| Class | Treatment |
| --- | --- |
| `md-h1`–`md-h6` | Per §3.2 |
| `md-quote` | 3px `--quote-border` left rule, `--quote-bg` wash, `--muted`, italic, `--serif`, `padding 0 12px`, radius `0 6px 6px 0` |
| `md-codeblock` | `--code-bg`, `--mono`, `0.9em`, `padding 0 14px`, `text-align: left` |
| `md-hr` | Text made transparent, replaced by a 1px `--border` bottom edge, line height `0.6em`. The markers are still in the DOM; only their color is hidden. |
| `md-list` | `text-indent: 0` — markers keep their natural hanging indent |

### 7.7 Inline decorations

- `.md-link` — `--link`, underlined with `text-underline-offset: 3px`
- `.gq-text` — the `«text»` guillemet span: `--code-fg` on
  `rgba(240,208,70,.14)`, radius 3px, `--serif`
- `.gq-mark` — the `«` and `»` delimiters themselves: `--marker` equivalent
  `#6f7b80`, no background

### 7.8 Note footer

A 1px-bordered strip below the editor. `#note-summary` is a 44px-minimum
disclosure row: created time, a 3px `::before` bullet plus the mood label, and a
chevron that rotates 180° over 0.18s when `#note-details` is open. Webkit
markers are suppressed; focus gets a 2px `--accent` outline at offset 3px.

Mood states, all driven by `data-state` on `#note-mood`:

| State | Presentation |
| --- | --- |
| `fresh` | `--fg` at full opacity |
| `updating` | Dimmed, plus an 8px spinner (`mood-spin`, 0.8s linear) |
| any other | `opacity: .65` and the label is the fallback copy |
| hidden | Distribution panel collapses with it |

`#note-mood-probabilities` is 11px/1.6, dimmed unless `fresh`, and each
`.mood-probability` is `white-space: nowrap` so the comma-separated list stays
readable.

### 7.9 Delete dialog

`min(380px, 100vw - 32px)` wide, radius 20px, `--surface` fill, 24px padding,
capped at `calc(100dvh - 32px)`. Structure: `.dialog-icon` (48px radius-14px
tile in a 12%-alpha danger wash) → `h2` → the quoted note title in `--fg` →
muted consequence copy → right-aligned `.dialog-actions` with Cancel (ghost)
and Delete note (danger).

---

## 8. Motion

| Motion | Timing |
| --- | --- |
| Button, field transitions | `0.12s` background-color, border-color |
| Summary chevron | `0.18s` transform |
| Mood palette crossfade | `1.8s ease` on `--lava-1/2/3` |
| Lava pools | 31s / 43s / 37s, `ease-in-out alternate infinite` |
| Mood spinner | `0.8s linear infinite` |

Easing is `ease` by default; `linear` only for the indeterminate spinner.

`prefers-reduced-motion: reduce` sets `transition: none !important` globally and
kills the pool, spinner and chevron animations.

Two debug flags are part of the system's diagnostic surface, added by
`main.ts` from the query string and safe to ship because they change nothing
else:

- `?nolava` → `.no-lava` freezes all three pools
- `?lavacalm` → `.lava-calm` leaves only pool one drifting

Use them to attribute frame cost; never use them to ship.

---

## 9. Accessibility

Hard floors, not preferences:

- **Touch targets ≥ 44 × 44px.** Buttons, inputs, the search field, `#new-note`,
  and `#note-summary` all clear this. `#sync-dot` is an 8px status pip and is not
  a target.
- **Body text ≥ 16px** wherever it is prose you would read on a phone.
- **Focus is always visible:** 2px solid `--accent` outline. Applied to buttons,
  inputs, `.note-card`, and `#note-summary`. The editor deliberately drops it —
  the blinking accent caret is the focus indicator there.
- **State is never colour alone.** Sync status pairs the dot colour with
  `#sync-label` text. Mood pairs its colour with a label and `aria-live`.
- `html { -webkit-tap-highlight-color: transparent }` suppresses the mobile flash
  on card taps; the card's `:hover`/`:active` treatment replaces it.
- `viewport-fit=cover` is set; nothing may sit under the notch — use
  `env(safe-area-inset-*)` if chrome ever moves to the edge.

---

## 10. Performance rules

The backdrop is the only continuously animating surface, so it carries strict
rules.

1. **Animate `translate` only.** No `scale`, no `rotate` on the pools. A
   scale-dependent effect forces Chromium to re-raster a viewport-sized layer
   every frame, which dominated INP presentation delay.
2. **Paint pools with radial gradients, not `filter: blur()`.** A gradient
   already has its own falloff. Blurring a solid re-rasterizes; a gradient
   rasters once.
3. **Keep `will-change: transform`** on `.lava-blob` and `#editor`. Both are
   cheap now that there is no blur surface to re-raster, and Chromium may
   otherwise demote viewport-sized layers back to main-thread painting.
4. **Promote `#editor`.** Keystrokes and scrolls otherwise repaint a region that
   blends the moving backdrop.
5. **Pause when unseen.** `.lava-paused` (set when no note is open or the tab is
   hidden) sets `animation-play-state: paused`. Nothing is being looked at, so
   nothing should be compositing.
6. **Never animate or transition an unregistered custom property.** `--lava-*`
   are `@property`-registered precisely so the 1.8s crossfade works.

---

## 11. Extension rules

**Change freely:** token values, radii, spacing, shadows, motion timing, the
`md-*` treatments, component skin.

**Never change:** any `id` in `index.html`; the class names `note-card`,
`active`, `card-preview`, `card-created`, `grid-row`, `md-h1`…`md-h6`,
`md-quote`, `md-codeblock`, `md-hr`, `md-list`, `md-link`, `gq-text`, `gq-mark`,
`lava-blob*`, `dialog-icon`, `dialog-actions`, `danger-button`,
`note-summary-*`, `mood-probability`; the names of any CSS variable consumed via
`var()` from `mdHighlight.ts` (`--mono`, `--code-fg`, `--code-bg`, `--muted`);
the `CARD_H` / `GAP` / `COLS_MIN_WIDTH` contract between `list.ts` and
`.grid-row`; the three `z-index` / `pointer-events` guarantees in §6; or the raw
text content of any note.

`npm run build` must pass.