# `src/supabase.ts`

The optional cloud backend, reduced to a single nullable export. If the Vite env
vars are absent, `supabase` is `null` and the app runs entirely local against
IndexedDB — this is the single place that decision is made, so every caller can
just null-check.

**Depends on:** `@supabase/supabase-js` (`createClient`, `SupabaseClient`), Vite `import.meta.env`
**Used by:** `main.ts`, `sync.ts`, `mood.ts`

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `url` | 3 | `VITE_SUPABASE_URL`, or `undefined` |
| `anonKey` | 4 | `VITE_SUPABASE_ANON_KEY`, or `undefined` |
| `supabase` | 7-8 | Configured client, or `null` when unconfigured |

## Walkthrough

### Client construction (lines 7-8)

The `as string | undefined` casts on lines 3-4 are needed because
`vite-env.d.ts` only carries `/// <reference types="vite/client" />`; this project
does not declare an `ImportMetaEnv` interface, so every custom `VITE_*` key
resolves to `any`/unknown. The casts are the local substitute for that typing.

Line 6's comment states the design intent: sync is a feature, not a requirement.
Both variables must be truthy (line 8) before a client is constructed, so a
half-configured `.env` degrades to local-only rather than throwing at module load.

Note the client is created eagerly at module-evaluation time and never
disconnected — `main.ts` and `mood.ts` import it for side-effect-free access, so
by the time any consumer reads it, the connection is already established.

## Gotchas

- Because the export is `SupabaseClient | null`, every consumer must narrow it.
  Adding a non-null assertion anywhere downstream silently assumes a configured
  deployment.
- The anon key is a public credential by design (it is baked into the bundle via
  `VITE_` prefix). It carries no privilege on its own; row-level security on the
  Supabase project is what actually protects data.
- This module reads `import.meta.env` at import time, so it cannot be unit-tested
  under a plain Node runner without a Vite transform.