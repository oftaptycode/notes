# Notes

A single-user, offline-first Markdown notes app. Notes are stored in IndexedDB;
Supabase sync is optional. Without the environment variables in `.env.example`,
the app stays local.

## Development

Use a current Node 24 release (24.15 or newer), then run:

```sh
npm install
npm run dev
npm test
npm run build
```

## Saving and sync

- Edits are saved locally immediately. Only network sync is debounced.
- Switching notes starts a fresh Undo history. Clearing a note (including
  whitespace-only text) deletes it immediately. New blank drafts are discarded
  when you leave them without typing.
- Failed local writes retain the editor text and block note switching. Keep the
  app open, retry, or copy the text before closing it.
- Sync downloads all notes in ID-paginated batches before uploading changes.
  This deliberately favors correctness over incremental-sync optimization for
  a small, single-user collection.
- Server writes compare the revision read by this device. If both devices edit
  a note, the local version stays in the original note and the server version
  is preserved as a `(conflict copy)`. Older dirty notes without a sync baseline
  may also produce a precautionary conflict copy on their first sync.
- The legacy `shita-notes` database is retained as a recovery backup after
  migration. No existing database is deleted by migration.

The existing Supabase `notes` table must support authenticated SELECT, INSERT
and UPDATE, enforce ownership with row-level security, and update
`server_updated_at` on **every** insert/update. Sync depends on that field being
a server-controlled revision. Backend policies and triggers are not managed by
this repository.

This remains a single-account app: local notes are not partitioned by account.
Do not switch accounts or Supabase projects without exporting your notes first.

## Regression tests

The small regression suite covers transactional saves, stale-editor backups,
Undo isolation, concurrent sync, conditional-write conflicts, and pagination.
It uses a fake IndexedDB and a mock server, never a live Supabase project.

## Markdown display

Formatting never rewrites the stored Markdown. Literal brackets like `[sic]`
remain visible; inline links and resolved reference links hide their syntax,
destinations and titles. Nested bold/italic text keeps its formatting. The
custom `«…»` parser and its existing appearance are preserved.

`src/markdown.ts` owns syntax hiding and structural decorations;
`src/mdHighlight.ts` owns inline text styles; `src/guillemets.ts` owns the custom
delimiter grammar. Rendering updates when the document or parse tree changes,
not on every cursor movement.
