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

## Note mood

The editor footnote detects the note’s emotional atmosphere once when you open
it, without a typing delay. It uses OpenAI’s Decisions API with
`gpt-6-luna` with the GoEmotions label set (27 emotions plus Neutral), not a BERT
model. Only the currently open note is analyzed; code and quoted material
are handled by the classifier’s instructions. Mood is not a diagnosis.

- The latest note text is sent to OpenAI through an authenticated Supabase Edge
  Function. OpenAI’s account data policies apply; this is not an on-device model.
- The key never reaches the browser. Access is restricted to your Supabase user.
- There are no typing-triggered requests, automatic retries or resume/reconnect
  requests. Unchanged notes reuse their cached label and probability distribution
  on that device, including after a reload. A request is needed again only when
  the text changes, the cache is cleared/missing, or the classifier version changes.
  Reopen a changed note to update its mood.
- Switching notes, deleting or signing out cancels pending work. An answer that
  arrives after editing is marked outdated, never presented as a fresh analysis
  of the newer text. Late answers cannot label a different note.
- Cached labels are stored locally, separately from notes. Changed text makes
  the previous label visibly outdated. Offline labels remain available; reconnect
  and reopen the note to refresh them.
- Mood never changes Markdown, timestamps or sync flags. Results do not sync
  between devices; each device caches its own labels.
- Notes shorter than 100 characters (after trimming outer whitespace) are skipped,
  with no mood footer or API request. This limit is also enforced server-side.
  A short note that grows past the limit is analyzed only when reopened.
- Notes over 50,000 characters are not submitted. Failures appear quietly in
  the footnote and do not block saving. No popups.
- The footnote starts collapsed, showing creation date and the main emotion.
  Click or tap the row to expand the mood-choice probabilities, highest first, hiding
  entries that round to 0%. The full distribution remains cached. These are the
  raw Decisions choice probabilities, not
  emotion intensities or probabilities after the separate Neutral gate. Rounded
  percentages can total slightly above or below 100%.
- Every note editor has a continuously moving, dark-tinted lava background.
  Your emotion palette follows the cached/detected mood and meaningful runners-up;
  unknown, Neutral and short notes use grays instead. Color changes transition
  smoothly without restarting the animation. Reduced-motion preferences disable
  movement. Mobile uses a lighter dark tint to keep the colors visible, with
  brighter secondary text for readability. This visual change makes no additional
  API requests.

The probability breakdown requires redeploying `note-mood` using the command
below. Existing label-only results stay visible until then, but will be refreshed
on note open rather than hiding the missing distribution behind the cache.

### One-time server setup

1. Copy `.env.mood.example` to `.env.mood` (which Git ignores).
2. Fill in `OPENAI_API_KEY` and `MOOD_USER_ID`. Find your user UUID under
   **Supabase Dashboard → Authentication → Users**. Never use a `VITE_` variable
   for the OpenAI key.
3. Run these commands, replacing `YOUR_PROJECT_REF` with your Supabase project ID:

```sh
npx supabase login
npx supabase secrets set --env-file .env.mood --project-ref YOUR_PROJECT_REF
npx supabase functions deploy note-mood --project-ref YOUR_PROJECT_REF
```

Then sign in to the app and open a note. Without deployment/secrets, the footer
will show **Mood unavailable**, not an invented label. The API is currently in
beta and your OpenAI project must have Decisions / `gpt-6-luna` access.

`verify_jwt = false` disables only the gateway’s legacy JWT verification. The
function itself verifies every bearer token with Supabase Auth and requires its
user ID to equal `MOOD_USER_ID`; unauthenticated and other users are rejected.
The server has a per-instance request safety limit, validates note sizes, times
out upstream calls, and never logs note text or secrets.
