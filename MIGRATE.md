# Android migration handoff

## Purpose and authorization

This is a plan for another agent to execute, not permission to change production data or deploy services. Inspect the current repository and its instructions before implementation. Preserve existing user changes. Do not reset files, delete databases, clear browser storage, or deploy without authorization.

Repository: `C:\Users\radia\notes`.

## Decisions already made

- Build an Android client in Kotlin with Jetpack Compose.
- Keep the current TypeScript web app. Do not rewrite it in Kotlin or introduce Compose Multiplatform.
- Keep Supabase Auth, the existing notes table, and the TypeScript `note-mood` Edge Function.
- Match the current inline Markdown editing behavior, including hidden syntax, custom `«…»` formatting, and per-note Undo.
- Migrate cloud notes only. Do not build an IndexedDB importer.
- Retain offline saving, search, deletion, export/copy, conflict copies, mood detection, and the mood-driven animated background.
- Keep the single-account product model. No multi-account feature is requested.

Use the smallest complete solution. No speculative abstractions, extra modules, framework layers, or avoidable dependencies. A deliberate shortcut with a known limit must have a `shortcut:` comment naming the limit and when to upgrade. Never use a shortcut to omit data safety, authorization, accessibility, validation, or tests of risky logic.

## Read before building

Map the current working tree, not only committed code:

- `README.md`, `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`.
- `src/main.ts`: save queue, navigation, authentication, boot, lifecycle.
- `src/db.ts`, `src/save.ts`, `src/types.ts`: transactions, note model, conflict copies.
- `src/sync.ts`, `src/supabase.ts`: server protocol and optional sync.
- `src/editor.ts`, `src/markdown.ts`, `src/mdHighlight.ts`, `src/guillemets.ts`: editor behavior.
- `src/list.ts`, `src/search.ts`, `src/searchIndex.ts`, `src/search.worker.ts`: list and search.
- `src/mood.ts`, `src/noteBackground.ts`, `src/dates.ts`, `src/style.css`, `index.html`: remaining features.
- `supabase/functions/note-mood/index.ts`, `supabase/functions/_shared/moods.ts`, `supabase/config.toml`: mood contract and authorization.
- All `tests/*.test.ts`, plus their helpers and setup.
- `PERFORMANCE-AUDIT.md` for historical measurements, not as proof of current behavior. Some findings describe code already replaced.

Source and tests take precedence over stale documentation. Do not expose `.env.local`, `.env.mood`, real notes, tokens, or API keys in logs or reports.

## Phase 1: prove editor feasibility before the full app

This is the go/no-go milestone. Styled text rendering alone does not reproduce CodeMirror editing.

Build an isolated Android editor prototype and test:

- Hidden Markdown syntax with correct cursor movement, selection, and deletion around hidden ranges.
- Headings, nested emphasis, lists, code blocks, inline links, reference links, and multiline hidden link destinations.
- The current `«…»` rendering and delimiter behavior.
- Copy/paste behavior that preserves the underlying Markdown without rewriting stored content.
- Android keyboard composition, suggestions, emoji, surrogate pairs, and accessibility.
- Undo isolated to each note; opening a different note must not expose another note's Undo history.
- Long-note editing and responsiveness on real Android hardware.

Use existing editor tests as the starting behavior specification. Explicitly test unclear clipboard and selection behavior against the web editor rather than guessing.

Exit condition: demonstrate the required behavior and acceptable typing latency on a real phone. Record the tested device and inputs; do not claim native parity based only on screenshots or emulator rendering.

If native editing cannot meet the requirement, stop and ask the user to choose between a narrowly scoped CodeMirror WebView editor and relaxing the editing requirement. Neither fallback is approved yet. Do not silently substitute raw Markdown plus preview or write a new general-purpose editor framework.

## Phase 2: minimal Android foundation

Keep the web project in place. Add `android/` with one Android application module.

Initial choices:

- Jetpack Compose and Material 3 for UI.
- Room for local persistence and transactions.
- Kotlin coroutines and Flow for asynchronous work and observed state.
- A Supabase Kotlin client, after verifying its current Android support, authentication persistence, timestamp handling, and conditional-update API.
- JVM tests for pure logic and focused Android/instrumented tests for storage, lifecycle, and editing.

Select compatible toolchain and dependency versions during implementation. Verify minimum Android version against the user's devices; no minimum SDK was agreed. Do not guess versions from this plan.

Start with one Activity, a screen ViewModel, and concrete persistence/sync classes. Do not add a domain layer, single-implementation interfaces, dependency-injection framework, or multi-module architecture without a demonstrated need.

Provide list and editor screens, with side-by-side presentation on suitable wide Android displays. Do not undertake a visual redesign.

## Phase 3: local persistence and safe saving

Port the behavior, not IndexedDB's internal structure. Preserve the existing wire-compatible note fields:

- ID, raw Markdown, creation time, edit time.
- Deleted and dirty flags.
- Last acknowledged server content, deletion flag, and revision.

Keep the acknowledged server revision as the original string. Do not truncate timestamp precision or replace it with a client timestamp. Preserve existing IDs and deletion records.

Requirements:

- Local editing and saving work without authentication or a network connection.
- Read, compare, write, and creation of conflict copies are atomic.
- Intervening versions are preserved rather than silently overwritten.
- Coalescing retains the first unflushed edit's comparison baseline and the latest text.
- Track queued and in-progress writes separately from committed state. Never label uncommitted text as saved.
- A failed write keeps editor text available and blocks navigation that would hide it.
- Observing the app's own database updates must not reset editor selection, scroll, or Undo.
- Match the existing blank-draft, whitespace deletion, and explicit delete behavior; test those rules explicitly.
- Dirty changes remain discoverable after restart. Do not rely on process shutdown callbacks to finish asynchronous writes.
- Define how brief uncommitted editing is protected against process death. If full recovery requires a durable draft, implement and test it; do not promise zero loss from in-memory state.

Exit condition: transactional save, conflict, failure, navigation, and restart tests pass. Committed edits survive process death; any remaining durability window is accurately described, not hidden behind a Saved label.

## Phase 4: authentication and compatible sync

Retain the existing Supabase schema and protocol. No backend redesign or schema migration is planned.

Preserve:

- Download/reconcile before uploading.
- ID-based pagination, including server response caps smaller than the requested page size.
- Revision-only checks followed by downloads of changed bodies.
- Conditional writes against the acknowledged server revision.
- Tombstones for cross-device deletion discovery.
- Conflict copies preserving both versions.
- Bounded upload concurrency and persistent-conflict backoff.
- Dirty flags when a request fails or newer text arrives during upload.

Do not replace this with unconditional upserts or a client-timestamp watermark. Keep revision comparison inside local write transactions. Do not hold a database transaction open over network calls.

Add finite request deadlines. A stalled request must eventually release the single-flight sync lock. Scope work to the current authenticated session: stop scheduling on sign-out, cancel where supported, and reject late results from an obsolete session. Cancellation does not prove the server did not commit; reconcile safely on the next attempt.

Use platform-appropriate session storage after checking the chosen client's defaults. The Supabase URL and public client key may be client configuration; the OpenAI API key must never enter Android resources, source, logs, or build output.

Remain single-account. Do not silently attach an existing local collection to a different user. Account switching and resetting local data require an explicit, safe policy; do not add automatic destructive cleanup.

Initially sync on launch, foreground, reconnect, and after edits. Background execution while the app is closed is not requested. Do not introduce WorkManager until that requirement exists.

Exit condition: Android and the existing web client can edit, conflict, delete, reconnect, and restart against the same isolated test account without losing versions.

## Phase 5: remaining feature parity

- Lazy note grid with bounded previews and accessible controls.
- Debounced, case-insensitive full-text search away from the UI thread; ignore obsolete results.
- Local creation-date display matching existing behavior.
- Explicit delete confirmation.
- Native Android export/copy actions preserving Markdown.
- Mood footer, probability breakdown, outdated states, and mood-driven background.
- Reduced-motion behavior and real-device keyboard/layout checks.

Mood rules:

- Call the existing authenticated Edge Function; do not call OpenAI directly.
- Analyze on opening a qualifying note, not on typing.
- Preserve the current minimum/maximum size rules and model/version response validation.
- Preserve cancellation, stale-answer checks, and account isolation.
- Keep mood metadata separate from notes; it must not alter note timestamps or sync flags.
- Cache results across reloads without an additional unbounded full-text memory cache.
- Fail quietly without blocking saving or inventing labels.

Verify the deployed function's actual contract with synthetic input before claiming end-to-end completion. Do not deploy or change server secrets without approval.

## Phase 6: cloud-only migration and release

No browser-storage importer is in scope. Before migrating real notes:

1. Open the existing web app on every device that holds unsynced notes.
2. Allow sync to finish and verify that no changes remain pending or failed.
3. Preserve conflict copies and verify expected notes in Supabase.
4. Sign into Android and download the cloud collection.
5. Check content, IDs, timestamps, deletion behavior, and conflict copies before using Android as the primary client.

Do not delete browser data or retire the web app. Cloud-only migration cannot recover local notes that never reached Supabase. Keep old clients/data available during the trial so users can recover or compare versions.

Before release, verify the live ownership policies and the server-controlled revision trigger. These are required by sync but are not managed in this repository. Use an isolated test account/project for destructive and race tests.

Signing, distribution channel, supported devices, and release ownership were not decided. Confirm them before production release; do not let them block the editor feasibility work.

## Regression and acceptance checks

Port meaningful existing regression cases into Kotlin. Preserve the web suite throughout.

- Failed, paused, and interrupted writes; saving labels reflect actual commits.
- Android Back/navigation with queued, in-progress, or failed writes.
- Undo isolation, cursor/selection around hidden syntax, keyboard composition, and accessibility.
- Simultaneous edits, intervening updates, conditional-write failures, and preservation of both versions.
- Smaller server page caps, tied revisions, new records, and tombstones.
- Editing during upload, successful workers finishing after another upload fails, and conflict backoff.
- Request timeout followed by recovery; sign-out during requests; obsolete-session responses ignored.
- Mood length limits, invalid responses, cached labels, outdated results, and rapid note switching.
- Offline launch/restart, large notes, many notes, and Android/web interoperability.

Keep pure tests deterministic. Test actual SQLite transactions and Android lifecycle behavior on Android rather than assuming JVM mocks prove them. Keep noisy performance thresholds out of ordinary unit tests; report real-device measurements separately.

Audit baseline, not a guarantee for a later working tree: 36 web tests passed; the production build passed; npm audit reported no known vulnerabilities. Those checks ran on Node 24.14.1, below the README's stated 24.15 minimum. Re-run using the documented supported runtime before relying on the baseline.

## Existing web safety issues

Retaining the web client also retains its bugs. Plan small, separately reviewed fixes, not a rewrite:

- `src/main.ts`: the close warning currently checks pending edits but misses an edit removed from that map while its write is still running.
- `src/main.ts`: the mobile popstate handler hides the editor before confirming a successful save; failed saves then prevent reopening it.
- `vite.config.ts`: `allowedHosts: true` disables hostname protection. Removing it still permits LAN access by IP.
- Tabs share IndexedDB but do not consistently refresh each other's visible state. Native Android must not inherit stale-observer behavior; web cross-tab notification is a separate compatibility improvement.

Reproduce each issue against current code and add a focused regression check before fixing it. The first three were confirmed during the audit, but source may change after this handoff.

## Delivery order and reporting

Deliver in this order:

1. Editor feasibility result and explicit go/no-go.
2. Local-only Android client with safe saves and navigation.
3. Authentication and compatible cloud sync.
4. Remaining feature parity.
5. Isolated migration trial and release checks.

For each milestone, state what works, which tests ran, what remains unverified, and any data-safety limit. Do not claim completion from a successful compilation alone.

Out of scope: Kotlin server, web rewrite, Compose Multiplatform, IndexedDB importer, multi-account support, speculative architecture, and automatic background sync.

Main unresolved risk: reproducing the existing editor's behavior in a native Android editor. Resolve it before committing to the rest of the rewrite.
