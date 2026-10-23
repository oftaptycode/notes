# `src/noteBackground.ts`

Takes the detected mood of the open note and turns it into a three-colour palette written onto the editor pane as the CSS custom properties `--lava-1/2/3`, which the drifting background blobs in `src/style.css` consume. It holds no state beyond the last palette it wrote, and never creates or animates anything itself.

**Depends on:** `../supabase/functions/_shared/moods` (types only)
**Used by:** `src/mood.ts`, `src/main.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `EMOTION_COLORS` | 3-31 | colour per non-`Neutral` mood; exhaustively typed |
| `GRAYS` | 32 | three neutral fallbacks |
| `NoteBackground` | 34 | exported type: `{ setMood }` |
| `createNoteBackground` | 36-59 | binds the palette to one element |
| `currentPalette` | 37 | memo of the last written colour triple |
| `setMood` | 38-56 | derives and applies the palette |

## Walkthrough

### `createNoteBackground` / `setMood` (lines 36-59)

`setMood(mood, probabilities)` builds the palette:

- No mood, or `'Neutral'` → the three greys (lines 39-40). Neutral deliberately does *not* get a colour of its own; it renders as "no emotional signal".
- Otherwise the dominant emotion's colour is slot 1, and slots 2-3 are the two strongest *runner-up* emotions (lines 44-48). The `>= 0.08` cut (line 45) is the point of the comment at lines 42-43: it blends meaningful second choices, not the long tail of near-zero entries. `Neutral` and the dominant mood are excluded from the candidate list.
- Line 49: if there is no second runner-up, slot 2 repeats the primary and slot 3 falls back to `GRAYS[0]`. Note only the *third* slot gets the grey fallback — the layering is primary / runner-up / depth, not three independent colours.

Writes go through `style.setProperty` (line 54) on the pane element, and the whole call is short-circuited when the joined palette string is unchanged (lines 51-52). This matters because `mood.ts` calls `setMood` from `render()`, i.e. on every keystroke; without the guard the browser would restart the 1.8s `transition` on `--lava-1..3` (`src/style.css:227`) continuously. The comment at line 55 records the other half of that guarantee: colours change without recreating the blob layers or restarting their animation.

Line 57 calls `setMood(null)` once at construction, so the three properties are initialised to the grey palette before any mood exists.

## Gotchas

- `EMOTION_COLORS` is typed `Record<Exclude<Mood, 'Neutral'>, string>` — adding a mood to `MOOD_CHOICES` without adding a colour here is a compile error, not a runtime `undefined`.
- Passing a `Mood` that is not in the map would index with `undefined` and emit `var(--lava-1)`-invalid values; the type is the only guard, and line 48's `as` cast on the runner-up values assumes the probability entries come from a validated payload.
- This module never reads or writes note content, storage, or sync state. It is pure presentation.
