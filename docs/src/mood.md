# `src/mood.ts`

A self-contained controller that detects the "mood" (emotional atmosphere) of the open note by calling a Supabase Edge Function, caches the result in a dedicated IndexedDB database plus an in-memory `Map`, and renders it as a small chip plus a probability breakdown in the note footer. It is constructed once by `src/main.ts` and fed `openNote` / `updateContent` / `setUser` / `clear` from the editor lifecycle; it never touches note content, timestamps or sync flags — mood metadata is strictly derived state.

**Depends on:** `idb`, `./supabase`, `./noteBackground`, `../supabase/functions/_shared/moods`, `supabase.functions.invoke('note-mood')`
**Used by:** `src/main.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `CachedMood` | 9-15 | cached record: key, analyzed content, mood, optional probabilities, timestamp |
| `MoodCache` | 16-18 | IndexedDB schema for the `results` store, keyed by `key` |
| `cacheDB` / `getCacheDB` | 19-24 | lazily-opened cache DB; resets itself to `undefined` if opening fails |
| `DisplayState` | 26 | `fresh` / `updating` / `stale` / `offline` / `unavailable` / `signin` |
| `Snapshot` | 27 | immutable `{id, content, userId, generation, key}` describing one analysis attempt |
| `createMoodController` | 29-283 | factory returning `{openNote, updateContent, setUser, clear}` |
| `note` | 30 | `{id, content, openedContent}` — live text vs frozen opening text |
| `generation` | 33 | monotonic staleness counter |
| `request` | 34 | in-flight `AbortController`, if any |
| `attempted` | 35 | "this opening already tried to analyze" latch |
| `memory` | 36 | `Map<key, CachedMood \| null>` — includes negative caching |
| `renderedProbabilities` / `distributionItems` / `distributionText` | 37-40 | memoized derived distribution state |
| `keyFor` | 41 | `model:version:userId:noteId` cache key |
| `hide` | 43-49 | clears both elements and resets the background palette |
| `cancel` | 51-55 | bumps `generation` and aborts the in-flight request |
| `isCurrent` | 56-59 | the staleness predicate |
| `render` | 60-115 | the single DOM writer for both elements |
| `loadCached` | 117-131 | memory → IndexedDB lookup with legacy-key fallback |
| `renderCached` | 133-135 | `fresh` if the cached content still matches, else `stale` |
| `prepare` | 137-152 | cache-first, then a chain of guards before analyzing |
| `analyze` | 154-210 | the Edge Function call, validation, caching |
| `begin` | 212-226 | entry point: environment checks, latch, first render, `prepare` |
| online/offline listeners | 228-238 | re-render from cache on connectivity changes |
| `openNote` / `updateContent` / `setUser` / `clear` | 240-283 | the public API consumed by `main.ts` |

## Walkthrough

### Cache keying and the two caches (lines 9-41)

`keyFor(id, user, version)` (line 41) namespaces by model *and* version, so switching `MOOD_VERSION` in the shared module retires old entries without a migration step. `parseMoodProbabilities` (line 126) upgrades a legacy record: a `v3` record read under the `v4` key keeps working, just without a distribution.

There are two caches, and they serve different purposes:

- **`memory`** (line 36) is a per-session `Map` in front of the IndexedDB read. It stores `null` for a miss (line 129), so a note with no cached mood is only ever read from disk once per session. Entries survive note switches but not a reload.
- **`getCacheDB()`** (lines 20-24) opens a *separate* database, `notes-mood-cache`, distinct from the notes database, so a corrupt or version-skewed mood cache can never block note saving. The `.catch` resets `cacheDB = undefined` so a later call retries the open rather than reusing a rejected promise.

Every disk write is fire-and-forget (line 203) and every disk read is wrapped in a bare `catch {}` (line 128). The comment at line 128 states the invariant directly: mood caching must never interfere with note saving.

### `generation` + `isCurrent()` (lines 33, 51-59)

`cancel()` is the only place that bumps `generation` (line 52), and it also aborts the in-flight `AbortController`. `isCurrent(snapshot)` (lines 56-59) requires that the snapshot's `generation`, `userId`, and note id all still match live state.

Every async continuation in the module checks it — after the cache read (line 139), before the fetch (line 155), after the fetch (lines 166, 179), after parsing the error body (line 179), and before the generic catch renders (line 205). This is the same pattern as `navigationVersion` in `main.ts`, but scoped to one component: it makes it safe for the user to open note B while note A's request is still on the wire. `cancel()` is called from `openNote`, `setUser`, `clear`, and the `offline` listener.

Subtle: `isCurrent` does **not** compare `snapshot.content` against the note's current content. That comparison is what `renderCached()` does to decide `fresh` vs `stale`, and it is why the opening-time response can legitimately arrive after typing has begun and still be shown — labelled outdated (lines 199-201).

### `render()` runs on every keystroke (lines 60-115)

`updateContent` is wired straight into the editor's doc-change path (`main.ts` line 213), so `render()` executes once per character typed. The function is written around that:

- Line 61 is the cheapest possible early exit: if the live content no longer clears `hasEnoughMoodContent`, `hide()`.
- Lines 65-69 compute the label from `cached?.mood` or the state, and only touch `textContent` when the string actually differs.
- Lines 84-90 memoize the expensive part. The 28-entry `filter/map/join` over `cached.probabilities` is redone **only** when the array identity changes, guarded by `renderedProbabilities`. The comment at lines 80-83 explains why the DOM itself cannot be cached the same way: a `DocumentFragment` is emptied by insertion, so it is rebuilt whenever `distributionText` differs (lines 93-102).
- Line 91 hides the distribution when every entry rounds to 0%.

Accessibility attributes are rewritten on every call too: `aria-busy` reflects `state === 'updating'` (line 70), `aria-label` includes the stale reason (lines 71-72), and `title` carries the explanatory copy (lines 73-76).

`background?.setMood(cached?.mood ?? null, cached?.probabilities)` at line 62 runs on every render as well. That is safe because `noteBackground.setMood` dedupes on the joined colour string and writes no CSS when unchanged.

### The `attempted` latch (lines 35, 212-226)

`begin()` refuses to do anything if `attempted` is already `true` (line 220). The flag is set immediately (line 221), and reset only in `openNote` (line 245) and `setUser` (line 263).

Consequence: **at most one network analysis per note opening.** If the call fails for any reason — offline, 500, invalid payload, thrown error — the user must reopen the note (or change user) before it is retried, which is exactly what the failure copy says ("Reopen the note to try again", line 206). This is what keeps a misbehaving edge function from being hammered by a user who keeps typing.

### `prepare()` guard chain (lines 137-152)

Cache first, then a series of terminal exits:

1. Line 141 — `!allowAnalysis`, or a cached record whose `content` matches the snapshot *and* has probabilities: render from cache and stop.
2. Line 142 — offline: render `'offline'`.
3. Lines 143-146 — over `MAX_MOOD_CONTENT_LENGTH` (50,000 chars): render `'unavailable'`.
4. Lines 147-150 — tab hidden: render `'unavailable'` rather than firing a request nobody is watching.
5. Line 151 — otherwise `analyze()`.

`allowAnalysis` is `false` only from `setUser` (line 266) when the note has been edited since it was opened; that call then does a cache-only pass.

### `analyze()` (lines 154-210)

`supabase.functions.invoke('note-mood', ...)` with a 25s timeout and an `AbortSignal` (line 164). The `try` covers both the `error` branch and the validation `throw`s.

Error handling is deliberately conservative: `FunctionsHttpError` exposes the `Response` as `.context`, and only if `context instanceof Response` does the code read the body, taking `body.error` and truncating to 200 chars (lines 170-178). A 401 becomes the `'signin'` state (lines 180-183); anything else becomes `'unavailable'` or `'offline'` depending on `navigator.onLine`.

The success path validates the payload shape before trusting it: `isMood(data.mood)`, an exact model match, a version that is either current or legacy, and — for the current version only — a parseable probability array summing to ~1 (`src/supabase/functions/_shared/moods.ts:94`). Anything else throws and lands in the generic `catch` (lines 204-206). Note that a *legacy* response with no probabilities is accepted and simply produces no distribution (line 192).

On success the record is written to `memory` synchronously (line 198) and to IndexedDB asynchronously (line 203), then `renderCached()` labels it `fresh` or `stale` depending on whether the user has typed since (lines 199-201).

### `openNote` / `updateContent` / `setUser` / `clear` (lines 240-283)

- `openNote` cancels, installs the note with `content === openedContent`, clears `cached`, resets `attempted`, and calls `begin()`.
- `updateContent` **never schedules a request and never changes `openedContent`** (comment at line 254). It only updates the live `content` and re-renders. If a request is in flight it renders `'updating'`; otherwise it renders from cache. This is the design decision behind "Reopen for mood": a note is analyzed exactly once, on the text as it was when opened.
- `setUser` cancels, resets `cached` and `attempted`, then calls `begin(note?.content === note?.openedContent)` (line 266) — i.e. only allow analysis if the note is untouched since opening. That handles auth resolving *after* the note was opened and possibly edited, without re-sending stale text.
- `clear` deletes both the current and the legacy key from `memory` and IndexedDB (lines 275-281) and hides the UI. `main.ts` calls this from `clearCurrent()`, which fires when the open note disappears — so locally deleting a note, or another device deleting it, permanently drops its cached mood.

### Connectivity listeners (lines 228-238)

`offline` cancels any in-flight request and re-renders from cache with `'fresh'` or `'offline'` copy. `online` re-renders from cache only — it does **not** clear `attempted`, so reconnecting never triggers a new network call by itself. Both are registered once per `createMoodController` call, which `main.ts` does exactly once.

## Gotchas

- `note.openedContent` is frozen for the lifetime of the opening and is the only text ever sent to the function. `note.content` is live. Anything that wants a re-analysis must call `openNote` again.
- `attempted` is not a per-request flag; it is per opening. A single transient failure costs the user a note reopen.
- `isCurrent()` checks identity, not content. Freshness is a separate concern (`renderCached`, line 134). Don't "simplify" `isCurrent` to compare content — that would make the opening-time response undisplayable after the first keystroke.
- `render()` must stay cheap. It is on the typing path; the memoization at lines 84-90 and the `textContent` equality checks are load-bearing, not micro-optimizations.
- `memory` caches `null` values. `if (memory.has(...))` at line 118 is a deliberate `has`, not truthiness — `memory.get(...) ?? null` would otherwise re-read from disk on every miss.
- Mood cache entries are keyed per user. Signing in as someone else cannot read another account's cached analysis.
- `clear()` is destructive: it deletes the IndexedDB record, not just the memory entry. There is no way to re-derive the mood without another network call.
- `analyze()`'s hidden-tab early return (line 158) fires *before* any `render()`, so if the tab is hidden in the narrow window between `prepare`'s check (line 147) and this one, the chip is left showing the `'updating'` / "Detecting…" state that `begin()` set at line 224, with `aria-busy="true"`, until some later render.
- `noteBackground` is optional (line 29). Every call site uses `?.`, so the controller works standalone in tests or if the pane element is absent.
