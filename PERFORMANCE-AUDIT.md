# Performance audit

Date: 2026-10-07. Scope: all tracked application source, styles, HTML, backend
functions, tests, dependency/build configuration, public assets, and the alternate
files in `claude's/`. The audit itself made no application behavior changes.

## Remediation — summary items 1–4

The user selected the first four items from the conversational summary:
**save refreshes, Markdown formatting, sync, and search**. The animated
background is intentionally unchanged. Findings below retain the original
baseline and numbering; they are not all statements about the remediated code.

- **Saves:** apply committed notes/conflict copies directly to the in-memory
  collection. Only affected cards update, with DOM work scheduled separately.
  Sync callbacks reread only changed IDs. The integration regression verifies
  one collection read at boot and none during edits, conflicts, or merged-ID
  refreshes; own saves do not reset the editor/Undo state.
- **Markdown:** reuse Lezer's unchanged block trees and mapped decoration sets;
  rebuild changed blocks and invalidate reference links when definitions change.
  Anonymous parser balancing groups are flattened so reshaping them does not
  invalidate all their paragraphs. Structural/random edits are compared with a
  fresh rebuild, including background parse completion and indented blocks.
- **Sync:** scan small `id,server_updated_at` records, fetch only changed/new
  bodies, and skip unchanged puts/refreshes. IndexedDB v2 maintains small
  revision/dirty records atomically with notes and backfills v1 installations.
  Dirty lookups no longer scan clean note bodies. Upload concurrency is capped
  at four; failures settle all workers before releasing the sync lock. Revision
  comparisons, tombstones, conflicts, and capped ID pagination remain intact.
  **An O(N) revision-metadata scan remains intentional:** no backend changes or
  unsafe timestamp watermark were introduced.
- **Search/list:** debounce queries by 80 ms, cache normalized note text in a
  lazily started worker, and reject stale query/data responses. Changed worker
  snapshots are coalesced until needed. A cached fallback handles worker failures.
  Visible cards are reused, previews are capped, same-window scrolls do not
  replace rows, and resize does not repeat full-text filtering.

### Post-fix synthetic measurements

Same editor fixture/browser as the baseline; separate run, not a controlled
physical-device benchmark:

| Document characters | Original median with decorations | Post-fix median with decorations |
| ---: | ---: | ---: |
| 9,400 | 5.5 ms | 3.4 ms |
| 94,000 | 108.3 ms | 31.5 ms |
| 470,000 | 643.2 ms | 110.5 ms |

Large-document parser/block bookkeeping costs remain: the post-fix 470 kB case
without custom decorations still measured 50 ms. These changes reduce expensive
inline rescans; they do not promise every arbitrarily large document fits a frame.

For 1,000/5,000 roughly 10 kB notes, targeted-list update dispatch medians were
0.5/0.8 ms. Worker query dispatch medians were approximately 0.1/0.0 ms (timer
resolution), with asynchronous result medians of 27.9/112.3 ms. These dispatch
measurements exclude deferred DOM/paint and the input debounce; worker result
time is not synchronous main-thread blocking. The raw full collection scan still
costs roughly 307/1,127 ms in this run, but no longer runs after saved edits.
Initial worker index population, huge notes, and live server/mobile performance
still need target-device profiling.

Validation after remediation: **29 tests passed across eight files**; production
TypeScript/Vite/PWA build passed; diff whitespace check passed. The built search
worker also passed a browser smoke test. The existing >500 kB main-bundle warning
remains (525.26 kB minified / 183.68 kB gzip); startup splitting was not in the
selected scope. No live Supabase/OpenAI traffic or backend deployment was used.

## Executive summary

The strongest explanations for sluggishness are:

1. **Every saved edit rereads the entire notes database and rebuilds the list.**
   Those reads are inside the serialized save queue, so a slow refresh delays
   subsequent saves and note switching, not just the sidebar.
2. **Custom Markdown formatting is rebuilt across the entire available syntax
   tree on every edit.** Synthetic measurements show substantial main-thread
   stalls on long, formatting-heavy notes.
3. **Three very large blurred layers animate continuously behind the editor.**
   This is a plausible GPU/battery bottleneck, especially on phones, but was not
   measured on the user's hardware.
4. **Sync repeatedly downloads and rewrites the whole collection**, including
   unchanged notes and deleted records, then uploads dirty notes serially.
5. **Search scans and lowercases every full note synchronously on every input.**

Fix the first two before micro-optimizing small helpers. Test disabling the lava
background as a separate A/B experiment. Preserve the existing transactional
saves, conflict backups, revision checks, and Undo isolation.

## Evidence and limitations

- `npm ci`: 425 packages installed; npm reported zero known vulnerabilities.
- `npm test`: **11 tests passed**, across four files. Total 63.28 s; reported
  environment share 95%, with approximately 29.81 s worker startup per file.
  Build and tests ran concurrently, so this is not an isolated tooling benchmark.
- `npm run build`: passed. Vite production bundling took 2.64 s and emitted its
  >500 kB chunk warning.
- Production main JS: **518.65 kB minified / 181.34 kB gzip**. CSS:
  **11.68 kB / 3.64 kB gzip**. PWA precache: **13 entries / 531.27 KiB**.
- Browser microbenchmarks: Windows, Electron 44.4.5 / Chromium 152, 1000×700
  viewport, local Vite server; synthetic data only. No production notes or
  credentials were used, and no live Supabase/OpenAI calls were made.
- Benchmarks are development-module CPU/storage measurements, **not INP, frame
  rate, cold-start Web Vitals, real typing latency, or mobile benchmarks**.
  Storage elapsed time includes asynchronous IndexedDB work; it does not imply
  the main thread was blocked for that entire duration.
- GPU traces, physical-device testing, deployed response compression/cache
  headers, database indexes/RLS plans, and live API latency remain unverified.
  Backend SQL policies/triggers are explicitly outside this repository.

### Measured editor scaling

Twenty single-character `EditorState` updates per case, at position 15 in repeated
Markdown blocks. The document is fully parsed before sampling. Comparison uses
the same Markdown grammar with and without `markdownDecorations`; it excludes
DOM rendering, local saves, mood updates, and list refreshes.

| Document characters | Median without custom decorations | Median with custom decorations | Maximum with decorations |
| ---: | ---: | ---: | ---: |
| 9,400 | 1.8 ms | 5.5 ms | 15.9 ms |
| 94,000 | 8.5 ms | 108.3 ms | 159.0 ms |
| 470,000 | 49.4 ms | 643.2 ms | 906.0 ms |

The largest case's final available tree covered 470,011 of 470,020 characters;
the earlier cases covered the complete updated document. These are deliberately
formatting-heavy notes, not representative estimates for every note. Removing
decorations is a diagnostic comparison, **not a proposed feature removal**.
The remaining grammar cost also becomes significant for very large notes.

### Measured collection scaling

Five samples per case. Approximately 10,570 characters per note, with a full
`synced.content` baseline. A separate temporary database reproduces
`getAllNotes()`'s `getAll → filter → sort` algorithm. Rendering and search invoke
the real `createList()` in an offscreen 320×600 container. Search is a nonmatching
query, so its result-list rendering is minimal.

| Notes | Median database read/filter/sort | Median visible-list rebuild | Median full-text search |
| ---: | ---: | ---: | ---: |
| 100 | 36.5 ms | 5.1 ms | 9.5 ms |
| 1,000 | 270.5 ms | 4.4 ms | 37.1 ms |
| 5,000 | 1,164.6 ms | 4.5 ms | 173.3 ms |

Virtualization successfully bounds the visible DOM cost, but **does not bound
database reads, content processing, search, or save-queue latency**. These samples
exclude the actual note-write transaction and painting. Real data, device load,
baseline presence, and engine string handling will change the numbers.

Reproduction: `docs/performance-benchmark.js` (instructions at end).

## Prioritized findings

Priority **P1**: address first; **P2**: material under common scaling/device
conditions; **P3**: secondary or tooling concern. “Confirmed” denotes an observed
code path, not necessarily a measured user-visible regression.

### 1. P1 — Collection-wide refresh is on every edit's persistence path

**Confirmed + measured.** `src/main.ts:99–114`, `src/main.ts:54–71`,
`src/db.ts:55–59`, `src/list.ts:101–104`.

Each document change queues `saveEdit`, schedules sync, and awaits
`refreshNotes()`. That reads all records (including tombstones and full sync
baselines), filters and sorts them, then calls `list.setItems()`. With an active
search it also scans all content again. Cost grows with total stored content,
not the size of the edit. `refreshVersion` rejects stale results only **after**
their database read has completed; it does not cancel or deduplicate reads.

**Recommendation:** keep immediate transactional persistence, but update the
in-memory note/list metadata from returned saved records. Refresh only affected
cards/order, and batch/coalesce nonessential sidebar refreshes independently of
the save queue. Reserve collection rereads for boot and genuine external merges.

### 2. P1 — Save backlog delays navigation and retains historical snapshots

**Confirmed, consequence of finding 1.** `src/main.ts:38–39,99–149,179–205`.

`writeQueue` appends work for every edit, without bounding/coalescing its tasks.
Each closure retains full `content` and `previousContent` snapshots until it is
processed. `pendingEdits` retains only the latest edit but does **not** remove
older queued tasks. `saveNow()` waits until the entire moving queue drains;
open/create/delete/back and pre-sync all depend on it. Sustained input can
outpace write + collection-refresh throughput, making note switching feel stuck
and increasing memory/GC pressure.

**Recommendation:** remove collection refresh from this queue first. Monitor
queue depth and oldest pending age. Any later save coalescing must preserve the
original comparison baseline, intervening-update backups, immediate empty-note
deletion, failures/retries, and flush-on-navigation semantics; do not blindly
debounce away the current durability guarantees.

### 3. P1 — Markdown decorations are globally rebuilt per document/tree update

**Confirmed + measured.** `src/markdown.ts:30–120,125–130`.

Every change rebuilds reference maps, link lists, per-line class sets, and
decoration arrays by traversing the entire available tree. Both decoration sets
are constructed with sorting; hidden ranges also appear in the combined set.
Lezer's incremental parser does not make this custom traversal incremental.
Background parse-tree advancement can trigger additional whole-tree rebuilds.
Nested blockquotes also revisit overlapping line spans through `lineStyle()`.

**Recommendation:** map existing ranges through document changes, rebuild dirty
blocks, and maintain reference-definition dependencies. Keep direct state
decorations for multiline replacements; moving everything to a viewport plugin
would break CodeMirror's multiline-replacement constraint. Separate global
reference resolution from local structural styling. Validate unresolved/resolved
links, atomic ranges, multiline titles, nested formatting, and guillemets.

### 4. P2 — Continuous oversized blur/compositing workload

**Confirmed implementation; device impact unmeasured.**
`src/style.css:235–299,454–467`, `index.html:44–49`.

Three pools approximately as large as the editor use 32–64 px blur, continuous
translation/rotation/scaling, permanent `will-change: transform`, and overlapping
opacity. Transform animation may be composited efficiently, but large filtered
surfaces still consume raster resources, compositing bandwidth, and texture
memory. At device-pixel ratio 3, equal CSS area has nine times as many pixels.
Background-color transitions can additionally invalidate their rasterized color.
On desktop this runs even when no note is open. Reduced motion stops movement
but leaves blur and `will-change` in place.

**Recommendation:** A/B test static background vs animation on affected devices;
use smaller/lower-resolution decorative surfaces, lower blur/overlap, and a
static/mobile quality mode. Pause when inactive/hidden and release unnecessary
layer hints. Do not claim this is the primary cause without device profiling.

### 5. P2 — Full remote collection download on every sync

**Confirmed.** `src/sync.ts:127–143,161–177`, `src/main.ts:295–312`.

Every authenticated sync selects complete rows in sequential 200-row pages,
including unchanged content and tombstones, plus a final empty-page request.
Triggers include the three-second post-save timer, every 30 seconds while
visible, resume, online, and auth events (not only initial sign-in). A smaller
server cap adds more pages. At 1,000 notes of 10 kB, a complete pull is roughly
10 MB of raw content before JSON overhead/compression, even for one small edit.
The full pull completes before any local dirty note is uploaded.

**Recommendation:** introduce a trustworthy incremental protocol with a stable
server revision cursor/tie-breaker and explicit tombstone semantics, plus periodic
full reconciliation. Do not substitute a naive client-timestamp cursor: the
current full/keyset approach deliberately protects correctness and pagination.

### 6. P2 — Unchanged remote rows still cause individual IndexedDB writes

**Confirmed.** `src/sync.ts:48–60,138`, `src/db.ts:84–94`.

Each downloaded row performs a separate readwrite transaction and a put, even
when a clean local row already matches the same server revision. This multiplies
transaction overhead and structured cloning, competes with typing saves on the
same object store, and makes unchanged collections expensive to sync.

**Recommendation:** skip unchanged revisions inside the comparison transaction;
batch page merges in bounded transactions while retaining transactional conflict
checks. Measure write contention and transaction duration, not just network time.

### 7. P2 — Dirty uploads are serial and sync requests lack a bounded deadline

**Confirmed.** `src/sync.ts:63–105,108–158`.

Each dirty note waits for its network write and local acknowledgement before the
next begins. Conflicts add a reread/merge/retry, up to three attempts. Large
offline backlogs therefore incur roughly one round-trip per note, after the
full download. There is no sync-specific AbortSignal/deadline or cancellation
on sign-out; a slow request can keep `running` true and postpone later attempts.

**Recommendation:** limited concurrency across distinct note IDs or a
revision-aware server batching endpoint, not unconditional upserts. Add explicit
timeouts/cancellation and account-session checks while preserving dirty flags
and conflict retries.

### 8. P2 — Redundant full local scans/refreshes per sync

**Confirmed.** `src/sync.ts:144–149`, `src/main.ts:274–277`, `src/db.ts:71–79`.

Successful sync refreshes the entire visible collection twice and calls
`getDirtyNotes()` twice; each dirty query reads **all** records. The existing
`updatedAt` index is unused by `getAllNotes()`; there is no indexed dirty/deleted
lookup or metadata-only store. Empty/no-op syncs still refresh both times.

**Recommendation:** return changed IDs from merges/acknowledgements, skip no-op
UI refreshes, and maintain a dirty-ID queue/index plus metadata-only list records.
IndexedDB booleans are not valid keys; use numeric flags/composite keys or a
separate queue rather than creating an index directly on boolean `dirty`.

### 9. P2 — Synchronous whole-collection search

**Confirmed + measured.** `src/main.ts:361`, `src/list.ts:32–40,117–120`.

Every input immediately calls `content.toLowerCase().includes(q)` on every note.
Lowercased text is not cached; resize, save refresh, and `refreshRow()` can repeat
the same filter. This allocates and scans content on the main thread. Measured
median for 5,000 roughly 10 kB notes was 173.3 ms per nonmatching query.

**Recommendation:** cache normalized search text keyed by content revision,
update it only when content changes, coalesce input updates, and move larger
collection search to a worker/index. Return stable result IDs without rebuilding
unchanged cards. Account for the memory cost of an additional normalized copy.

### 10. P2 — Virtualized list rebuilds all visible cards on every scroll frame

**Confirmed.** `src/list.ts:43–98,113–115`.

The list is virtualized, but `render()` recreates all visible rows/cards, dates,
ARIA values, and two handlers per card, then `replaceChildren()` on every
scheduled scroll frame—even if `startRow`, columns, items, and active ID did not
change. Activation and save refresh do the same. `applyFilter()` also interleaves
layout-sensitive reads with scroll/style writes. This creates avoidable DOM/GC
work; measure forced layout before attributing it to layout thrashing.

**Recommendation:** render only on virtual-window/data changes, reuse keyed
cards, toggle only affected active styles/attributes, delegate input handlers,
and group layout reads before writes. Preserve keyboard focus during updates.

### 11. P2 — Preview/title extraction processes far more content than displayed

**Confirmed.** `src/list.ts:62–68`, `src/types.ts:37–44`.

Each visible card splits the entire content once for its title and again for a
six-line preview. Titles only need the first nonempty line. Six source lines can
also contain megabytes (especially a single huge paragraph); CSS line-clamp
hides pixels, not DOM text, splitting allocations, or all text-layout work.

**Recommendation:** bounded line/character scanning, explicit preview character
caps, and cached title/preview metadata regenerated only for changed content.
Keep the complete original note available in the editor/export.

### 12. P2 — Full content snapshots, comparisons, and note reload work

**Confirmed; incremental cost not isolated.** `src/editor.ts:24–49,59–72`,
`src/main.ts:66–70,117–126,152–176`.

Each editor change converts the CodeMirror document to a complete string, stores
full current/previous snapshots, performs mood equality checks, and persists the
full record. Refresh can call `getContent()` multiple times. Loading a note
recreates all editor extensions/state/history and scrolls to the start; returning
to the same note still dispatches editability and rerenders the list. The initial
editability change is also not guarded against an unchanged value.

**Recommendation:** reduce repeated string extraction, pass one snapshot through
the save/mood/refresh path, and use edit revisions where appropriate. Reuse
immutable extension configuration and avoid redundant reconfiguration. History
reset on actual note switches is intentional; do not optimize by allowing Undo
to cross notes. Establish a large-note mode for grammar, wrapping, and spellcheck
if measured large-document latency remains unacceptable.

### 13. P2 — Tombstones, baselines, and conflict copies amplify data volume

**Confirmed.** `src/db.ts:55–79`, `src/types.ts:1–25`, `src/sync.ts:31–60`.

Deleted records are never physically purged here, yet every scan and remote pull
reads them. A full acknowledged content baseline lives in `synced.content`;
dirty versions retain old and new bodies. Sync conflict copies are additional
full notes. Consequently the visible note count understates storage/scan cost.
Actual engine string sharing and on-disk compression must be measured, not
assumed to make every duplicate exactly double memory.

**Recommendation:** metadata-only reads and bounded derived caches first; design
safe tombstone compaction only with cross-device acknowledgements/retention.
Keep enough baseline data for conflict detection and never silently delete
conflict backups as a performance shortcut.

### 14. P2 — Legacy migration repeats on every page boot

**Confirmed, conditional on legacy database presence.** `src/db.ts:15–47`.

Keeping `shita-notes` as backup means it remains discoverable. Each new page's
first DB access reads all legacy notes and performs sequential per-ID lookups in
a readwrite transaction, even after successful migration. Boot awaits this
before rendering notes or enabling creation. Multiple tabs can repeat it.

**Recommendation:** a successful, versioned migration marker; bounded cursor
chunks for large backups. Retain the recovery database and retry unfinished
migrations. Decide explicitly whether later legacy writes need reconciliation.

### 15. P2 — Single eager production bundle and restored-editor work

**Confirmed bundle size; startup impact device/network dependent.**
`index.html:89`, `src/main.ts:1–12,26–43,428–441`, `src/editor.ts:1–7`,
`vite.config.ts:4–26`.

The main module eagerly creates the editor before boot/list data is ready. The
last note is restored, including editor state and mood initialization, even on
mobile where boot then hides the editor to show the list. There are no lazy
module boundaries. `@codemirror/lang-markdown` transitively includes HTML/CSS/JS
language support; `npm ls` confirms this graph and no duplicate core CodeMirror
versions. The measured **unconfigured/local** build contains no Supabase runtime
strings; dead-code elimination appears to remove that optional branch. Do not
attribute its 519 kB to Supabase. A configured build may include that client and
was not measured.

**Recommendation:** measure production cold-start with/without configuration,
defer editor creation/restoration until needed, and consider lazy optional
network functionality and language support. Merely splitting vendor chunks
without deferring execution will not remove CPU work. Verify Brotli/gzip and
long-lived caching of fingerprinted assets on the real host.

### 16. P2 — Mood requests add serial remote latency and repeated cold-device work

**Confirmed; API latency unmeasured.** `src/mood.ts:101–149,196–250`,
`supabase/functions/note-mood/index.ts:33–87`.

A qualifying note open may issue an Edge Function request, then a Supabase Auth
verification request, then an OpenAI request with the complete note and two
questions. Maximum input is 50,000 UTF-16 code units. Each device has its own
cache, and changed/reopened notes need new classifications. Rapid switching
cancels browser work, but cancellation propagation to the provider/deployed
runtime must not be assumed. The browser and server use 25 s and 20 s deadlines.
These requests are asynchronous and do **not** block saving/opening; mood-label
delay alone should not be described as editor input lag.

**Recommendation:** measure each network stage; consider validated local JWT
verification with cached signing keys and a server-side content/version result
cache or in-flight deduplication. Preserve owner authorization and privacy;
token verification cannot simply be skipped. Any content sampling/model change
needs an explicit quality/versioning decision.

### 17. P3 — Mood caches retain full note text without collection-wide eviction

**Confirmed.** `src/mood.ts:9–24,36,101–114,177–187,252–264`.

The in-memory Map retains a complete analysis snapshot for each visited note.
IndexedDB stores full note text alongside probabilities. No LRU/TTL/cap or
classifier-version sweep exists; cleanup targets only the cleared current note
and one legacy key. Old version/account/deleted-note records may remain.

**Recommendation:** bounded memory cache and version-aware persistent cleanup;
use an asynchronously computed content fingerprint plus note revision if it can
preserve exact cache validation. Do not add synchronous whole-note hashing to
every keystroke.

### 18. P3 — Mood UI/eligibility work remains in the typing path

**Confirmed, small bounded distributions.** `src/mood.ts:56–98,232–240`,
`src/noteBackground.ts:38–54`, `supabase/functions/_shared/moods.ts:9–14`.

Typing rechecks content eligibility and updates footer state/attributes; it
filters/formats up to 28 probabilities and computes runner-up palettes even
after the mood has already become stale. Text/palette guards avoid much DOM
replacement, but attribute writes and small-array work still recur.
`hasEnoughMoodContent()` stops after 100 Unicode characters, although its
preceding `trim()` can scan large outer-whitespace runs. `saveEdit()` also trims
full content to detect deletion.

**Recommendation:** update the footer only on relevant eligibility/state
transitions, cache derived distribution/palette text, and profile pathological
whitespace inputs. This is lower priority than global rescans; the normal 28-item
sort/filter is not evidence of a meaningful bottleneck.

### 19. P3 — Keyboard/viewport layout churn and expensive text layout

**Confirmed implementation; mobile effect unmeasured.** `src/main.ts:415–425`,
`src/style.css:318–321,384–401`, `src/editor.ts:33,39–44`.

Each `visualViewport` resize immediately changes app height and dispatches
scroll-into-view. Keyboard animation can emit many resizes, causing repeated
editor measurement/layout and list ResizeObserver refresh/filter work. Editor
line wrapping, justified text, spellcheck, and very long paragraphs can compound
layout costs. The delete dialog's backdrop blur is a smaller, temporary GPU cost.

**Recommendation:** coalesce viewport work per animation frame, ignore unchanged
heights, scroll only when necessary, and separate resize geometry from search
filtering. Benchmark long wrapped lines and spellcheck on actual Android/iOS
devices before changing text layout or accessibility behavior.

### 20. P3 — Lifecycle cleanup and page-cache opportunity

**Confirmed lifetime pattern; not a demonstrated production leak.**
`src/list.ts:90–98`, `src/mood.ts:212–222`, `src/sync.ts:170–177`,
`src/main.ts:403–408`.

List/mood factories expose no listener/observer teardown, and sync owns a global
interval. The production app creates these once, so this alone is **not** an
unbounded leak. Repeated construction in tests/HMR/future routing can accumulate
them. The always-attached `beforeunload` listener can reduce back/forward-cache
eligibility in browsers such as Firefox, making return navigation costlier.

**Recommendation:** explicit disposers if lifecycle becomes reusable; consider
attaching the unload guard only while unsaved edits exist. Retain data-loss
protection and test the intended browser lifecycle carefully.

### 21. P3 — Backend body parsing and request limits are not globally bounded

**Confirmed.** `supabase/functions/note-mood/index.ts:39–63`.

Every request performs Auth network verification before body/rate validation.
`Content-Length` is only an advisory precheck; absent or misleading headers allow
`request.json()` to buffer a large body before the content-size rejection. The
60-per-minute safety limit is per instance, not global, and does not limit
concurrent provider requests. Body reading is not explicitly tied to the fetch
timeout's signal. Under malformed or burst traffic, memory/network/provider
capacity can be consumed even when useful classifications are rejected.

**Recommendation:** bounded streaming body reads, a platform/gateway payload
limit, and authenticated global/concurrent quotas if traffic warrants them.
Reject obviously oversized bodies before expensive downstream work without
weakening authentication or logging private note content.

### 22. P3 — Performance regressions have little automated coverage

**Confirmed.** `tests/*.test.ts`, `vitest.config.ts:4–10`, `package.json:6–10`.

Tests protect save/conflict/pagination/Undo/Markdown correctness, but not the
integrated edit→save→refresh pipeline, large collections/documents, search,
scrolling, animation budgets, migration startup, or mood lifecycle/cache behavior.
The observed test runtime is dominated by jsdom worker startup, not test bodies.

**Recommendation:** add benchmark fixtures and counters for DB scans/transactions,
queued saves, decoration rebuilds, and card replacements. Keep noisy wall-clock
budgets out of ordinary unit tests; use controlled browser performance runs.
Measure isolated test startup before changing worker isolation, since shared
modules/global listeners can compromise the current database/timer isolation.

## Areas inspected with no additional material finding

- `src/guillemets.ts`: constant-time delimiter handling per encountered character;
  no bespoke whole-document scan. Covered by the overall grammar budget.
- `src/mdHighlight.ts`: static style definitions, not cursor-triggered work.
- `src/dates.ts`: small formatting helper; caching card dates is useful only as
  part of avoiding repeated card construction.
- `src/supabase.ts`: one client instance when configured, not one per edit.
- `src/types.ts`: UUID generation is not a meaningful hot path; title splitting
  and full conflict-copy bodies are covered above.
- `public/`: all four icons total 9,275 bytes; no large images or external fonts.
- PWA caching improves repeat/offline loading. It precaches the complete build,
  so first install and updates still transfer assets. No custom broad network
  runtime cache or cache-growth policy appears here.
- `claude's/style.css` and `claude's/mdHighlight.ts` are not imported by the app.
  The alternate plugin rescans on cursor/viewport transactions, but that is
  **not an active-code finding**. Do not optimize or delete these files on the
  assumption that they ship.
- Existing virtualization, scroll `requestAnimationFrame` scheduling, no
  cursor-only Markdown rebuild, mood caching/request cancellation/no typing
  requests, sync single-flight locking, bounded mood deadlines, and system fonts
  are positive performance safeguards.
- `getAllIncludingDeleted()` and `refreshRow()` have no current application
  callers; their cost is not counted as an active extra scan.
- Supabase `(user_id, id)` pagination, revision-write lookup indexes, RLS cost,
  revision-trigger cost, and connection/region configuration need deployed
  `EXPLAIN`/metrics. The repository cannot establish whether those are missing or
  slow; do not apply speculative database migrations.

## Recommended order and acceptance checks

1. **Decouple persistence from collection refresh.** An edit should write the
   affected note without reading every note. Monitor queue age; note switching
   should not wait for cosmetic list work. Existing save/conflict tests must pass.
2. **Make custom formatting incremental.** Compare 10 kB/100 kB/500 kB plain,
   rich-Markdown, nested-quote, code-block, and reference-heavy notes. Verify all
   existing syntax/atomic-range behavior. Aim for common synchronous edit work
   below a 16.7 ms frame and avoid >50 ms main-thread tasks on target hardware.
3. **A/B test the background on the affected device.** Compare idle energy,
   GPU memory/frame deadlines, typing, and scrolling at DPR 1/2/3. Adopt a static
   fallback if animation competes with interaction.
4. **Reduce list/search work.** Cache bounded previews, update keyed cards, and
   avoid a rerender when the virtual row window is unchanged. Test 100/1,000/5,000
   notes, active searches while typing, and keyboard focus retention.
5. **Optimize sync without weakening consistency.** Count network bytes, pages,
   unchanged local puts, transactions, and upload duration. An unchanged sync
   should perform no unnecessary note writes/UI refreshes. Retest simultaneous
   edits, smaller server caps, timestamp ties, tombstones, and failed writes.
6. **Optimize startup and bound caches.** Test fresh/offline/return visits,
   with/without legacy data, configured/local builds, mobile list-first restore,
   and many visited notes. Keep private data out of diagnostics.

### Reproducing the synthetic measurements

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 4179 --strictPort
```

Use a separate localhost origin/test browser profile. In that page's console:

```js
const { runPerformanceAudit } = await import('/docs/performance-benchmark.js');
await runPerformanceAudit('editor');
await runPerformanceAudit('storage');
```

The storage section now reports targeted-list dispatch and worker search rather
than the historical synchronous-render/search columns. `rawCollectionScan` is
retained as a boot/diagnostic comparison, not as the per-edit implementation.

Storage fixtures use a uniquely named temporary database, deleted after the run;
they never touch `notes-db`, `shita-notes`, or the mood cache. Editor fixtures use
standalone states, not the open note. List observers/search workers are disposed
after the storage run. Close the test page afterward. Runs temporarily occupy CPU and, for the
largest storage case, tens of MB or more of temporary storage/memory. Repeat on
target hardware and use production browser traces for end-to-end conclusions.
