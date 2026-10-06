import { tags } from '@lezer/highlight';
import { HighlightStyle } from '@codemirror/language';

// Inline text styles only. Syntax hiding and structural styles live in markdown.ts.
export const mdHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700' },
  { tag: tags.heading2, fontWeight: '700' },
  { tag: tags.heading3, fontWeight: '600' },
  { tag: tags.heading4, fontWeight: '600' },
  { tag: tags.heading5, fontWeight: '600' },
  { tag: tags.heading6, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: tags.monospace, fontFamily: 'var(--mono)', fontSize: '0.88em', color: 'var(--code-fg)', backgroundColor: 'var(--code-bg)', borderRadius: '4px', padding: '1px 4px' },
  { tag: tags.quote, color: 'var(--muted)' },
]);
