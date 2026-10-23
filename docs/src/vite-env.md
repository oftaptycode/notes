# `src/vite-env.d.ts`

A one-line ambient declaration file. The triple-slash directive pulls in Vite's
client-side type definitions, which is what makes `import.meta.env.*` type-check
under `tsc` (the build runs `tsc && vite build`, per `package.json:8`).

**Depends on:** `vite/client` types
**Used by:** `tsconfig.json` compilation of the whole `src/` tree

## Symbol map

| Symbol | Lines | Role |
| --- | --- | --- |
| `/// <reference types="vite/client" />` | 1 | Injects Vite's ambient client types |

## Walkthrough

### Line 1

- This file exports nothing. It exists purely so the TypeScript compiler picks
  up `vite/client`'s ambient declarations — including the `ImportMetaEnv`
  interface used for `import.meta.env` — and so `*.css`, `*.svg` and similar
  Vite asset imports resolve during `tsc`.
- It follows Vite's documented convention: a `.d.ts` in `src/` with the
  reference directive, which is included because `tsconfig.json` picks up the
  directory it sits in.

## Gotchas

- Deleting it makes `tsc` fail even though `vite build` would still work —
  the bundler does not read these types.
- Vite's scaffold normally also adds `vite-env.d.ts` to `tsconfig.json`'s
  `include`; if that entry is ever removed this file stops having any effect.
