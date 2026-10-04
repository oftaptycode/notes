Dear Designer,

Thanks for taking a look at this little notes app. It works; it just
doesn't look like much. The job: make it look good. Not faster, not
smarter — prettier. But prettier with rules.

Here is what you may touch:

- src/style.css — go wild: colors, typography, spacing, rounded corners,
  shadows, whatever makes you proud.
- src/mdHighlight.ts — you may change the values inside
  HighlightStyle.define([...]) (colors, weights, fonts, backgrounds).
  Everything else in that file stays untouched.

Here is what you must NOT touch:

- index.html, src/main.ts, src/list.ts, src/editor.ts, src/db.ts,
  src/sync.ts, src/supabase.ts, src/types.ts, vite.config.ts,
  package.json, tsconfig.json, and the public/ folder (icon story comes
  later). Treat them as read-only context so you know what CSS hooks
  exist.

Hard constraints — violate any of these and the app breaks:

1. Keep every ID in index.html exactly as-is. main.ts looks these up:
   app, list-pane, editor-pane, list-scroll, list-spacer, list-rows,
   search, new-note, back, delete-note, export-note, save-state, editor,
   auth-bar, auth-btn, auth-user, sync-dot, sync-label, auth-form,
   auth-email, auth-password, auth-error, auth-signin, auth-signup,
   auth-close, editor-header, list-header.

2. Keep every class name in style.css and every class produced by
   list.ts (row, active, title, date) and mdHighlight.ts (md-h1 … md-h6,
   md-quote, md-codeblock, md-hr, md-list). You may restyle them freely;
   renaming them breaks the app.

3. The CSS variables in :root and in the
   @media (prefers-color-scheme: dark) block are referenced from
   mdHighlight.ts as var(--...). Keep the same variable names; change
   their values however you like.

4. Keep editor font-size >= 16px, touch targets >= 44px, and both
   light and dark schemes respected.

5. Keep the layout: list + editor side by side at >= 800px, one pane at
   a time below that, and #app sized with 100dvh.

6. Do not alter the text content or strip markdown markers. The raw
   Markdown is the document; we only paint over it.

7. When you're done, `npm run build` must still succeed.

Make it beautiful. Nothing fancy goes into the build but charm.

Yours,
`Fledge Alpha Free on Opencode`
