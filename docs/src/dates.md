# `src/dates.ts`

A seven-line formatting helper for the note list and note footer. It renders a
note's `createdAt` epoch-millisecond timestamp as a fixed, sortable-looking
string; the app stores timestamps as numbers (`Note.createdAt` in
`src/types.ts`), and this is the single place they become human-readable text.

**Depends on:** nothing
**Used by:** `src/main.ts`, `src/list.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `formatCreatedAt` | 2-7 | Formats a timestamp as `Created: YYYY-MM-DD HH:mm` |

## Walkthrough

### `formatCreatedAt` (lines 2-7)

- Wraps the number in `new Date(...)` (line 3), then guards with
  `Number.isFinite(date.getTime())` (line 4). A non-finite timestamp (`NaN`,
  `Infinity`, or an out-of-range number) produces the literal string
  `'Created: unknown'` instead of `"Created: NaN-aN-aN NaN:NaN"`, which is
  what the template literal would otherwise emit.
- The local `pad` closure (line 5) zero-pads to two digits, giving fixed-width
  month/day/hour/minute fields so list rows align.
- Line 6 builds the string from **local** getters: `getFullYear`, `getMonth() + 1`
  (zero-based, hence the `+1`), `getDate`, `getHours`, `getMinutes`. The header
  comment (line 1) states the reason: UTC getters would show a different
  calendar day than the user just typed into, and a locale-dependent format
  (`toLocaleString`) would reorder or re-spell the fields depending on the
  device's locale settings.
- Minutes are the smallest unit. Seconds are dropped, so two notes created in
  the same minute render identically.

## Gotchas

- The output is a *display* string only. `src/main.ts:121-122` builds its own
  `Date` from the same timestamp to derive the `datetime` attribute, so the
  machine-readable value does not depend on this string's format.
- The function never throws; every input, including `NaN`, produces a string.
- There is no separator-sort guarantee beyond the fixed width: the year is not
  padded, but a 4-digit year always sorts correctly inside `YYYY-MM-DD`.
