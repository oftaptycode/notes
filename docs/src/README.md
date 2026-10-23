# Source module reference

One document per TypeScript file in `src/`. Each covers what the module is for,
a symbol map with line ranges, a walkthrough of the non-obvious logic, and the
invariants a reader could easily get wrong.

Line numbers refer to the file as of 2026-10-11. The app is small enough that
these files are meant to be read top to bottom.

## Entry point and state

| File | Role |
| --- | --- |
| [main.ts](main.md) | App entry point. Owns DOM refs, in-memory note state, the save queue, navigation, auth UI, and boot. |
| [db.ts](db.md) | IndexedDB layer. Notes plus a small `syncMetadata` store; read-compare-write transactions; legacy migration. |
| [types.ts](types.md) | The `Note` shape, conflict-copy creation, UUIDs, and title extraction. |

## Editor and rendering

| File | Role |
| --- | --- |
| [editor.ts](editor.md) | Wraps CodeMirror. Owns the editable compartment and document-replacement behaviour. |
| [markdown.ts](markdown.md) | Incremental Markdown decorations: heading/quote/list line styles, hidden markers, link resolution. |
| [mdHighlight.ts](mdHighlight.ts) | Static Lezer highlight style for inline Markdown text. |
| [guillemets.ts](guillemets.ts) | Inline `«text»` delimiter extension for the Lezer Markdown parser. |

## Note list and search

| File | Role |
| --- | --- |
| [list.ts](list.md) | Virtualized card grid with keyed card reuse and query debouncing. |
| [search.ts](search.ts) | Main-thread side of worker search: lifecycle, coalescing, and the fallback path. |
| [search.worker.ts](search.worker.md) | Worker entry point; dispatches messages to a `SearchIndex`. |
| [searchIndex.ts](searchIndex.ts) | The normalized-text index and the message/result types shared across the worker boundary. |

## Sync, mood, and shell

| File | Role |
| --- | --- |
| [sync.ts](sync.ts) | Supabase sync: ID-paginated pull, revision reconciliation, capped-concurrency uploads. |
| [supabase.ts](supabase.ts) | Optional Supabase client; `null` when env vars are absent, which makes the app local-only. |
| [save.ts](save.md) | The single write path for keystrokes; conflict-copy decisions live here. |
| [mood.ts](mood.ts) | Mood detection controller: caching, request lifecycle, staleness guards, and the footer UI. |
| [noteBackground.ts](noteBackground.ts) | Maps a detected mood onto the three CSS palette variables behind the editor. |
| [dates.ts](dates.md) | Human-readable created-date formatting. |
| [vite-env.d.ts](vite-env.md) | Ambient Vite client types. |

## Related

- [`../../PERFORMANCE-AUDIT.md`](../../PERFORMANCE-AUDIT.md) — measured performance work, including the background/compositing findings.
- [`../../docs/performance-benchmark.js`](../../performance-benchmark.js) — synthetic microbenchmarks for editor, storage, and text helpers.