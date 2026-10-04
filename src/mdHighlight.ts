import { tags } from '@lezer/highlight';
import { syntaxTree, HighlightStyle } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate, type DecorationSet } from '@codemirror/view';
import { EditorState, type Range } from '@codemirror/state';
import type { SyntaxNodeRef } from '@lezer/common';

// Inline styles. Marker characters get a dimmer color but stay visible.
export const mdHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700' },
  { tag: tags.heading2, fontWeight: '700' },
  { tag: tags.heading3, fontWeight: '600' },
  { tag: tags.heading4, fontWeight: '600' },
  { tag: tags.heading5, fontWeight: '600' },
  { tag: tags.heading6, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'var(--mono)', backgroundColor: 'var(--code-bg)', borderRadius: '3px', padding: '0 2px' },
  { tag: tags.link, color: 'var(--link)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--link)' },
  { tag: tags.quote, color: 'var(--muted)' },
  { tag: tags.contentSeparator, color: 'var(--marker)' },
  // All markers: HeaderMark, QuoteMark, EmphasisMark, CodeMark, ListMark, LinkMark, StrikethroughMark, HardBreak
  { tag: tags.processingInstruction, color: 'var(--marker)' },
  // Task checkboxes `- [ ]` / `- [x]`
  { tag: tags.atom, color: 'var(--marker)' },
  { tag: tags.labelName, color: 'var(--marker)' },
]);

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'md-h1', ATXHeading2: 'md-h2', ATXHeading3: 'md-h3',
  ATXHeading4: 'md-h4', ATXHeading5: 'md-h5', ATXHeading6: 'md-h6',
  SetextHeading1: 'md-h1', SetextHeading2: 'md-h2',
};

function linesIn(state: EditorState, from: number, to: number, cls: string, out: Range<Decoration>[]) {
  let lineFrom = state.doc.lineAt(from).number;
  const lineTo = state.doc.lineAt(Math.max(from, to - 1)).number;
  for (let n = lineFrom; n <= lineTo; n++) {
    out.push(Decoration.line({ class: cls }).range(state.doc.line(n).from));
  }
}

function buildLineDecorations(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      const name = node.name;
      const hc = HEADING_CLASS[name];
      if (hc) {
        out.push(Decoration.line({ class: hc }).range(state.doc.lineAt(node.from).from));
        return;
      }
      if (name === 'Blockquote') {
        linesIn(state, node.from, node.to, 'md-quote', out);
        return;
      }
      if (name === 'FencedCode' || name === 'CodeBlock') {
        linesIn(state, node.from, node.to, 'md-codeblock', out);
        return;
      }
      if (name === 'HorizontalRule') {
        out.push(Decoration.line({ class: 'md-hr' }).range(state.doc.lineAt(node.from).from));
        return;
      }
      if (name === 'ListItem') {
        out.push(Decoration.line({ class: 'md-list' }).range(state.doc.lineAt(node.from).from));
        return;
      }
    },
  });
  return Decoration.set(out, true);
}

export const markdownLinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildLineDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
        this.decorations = buildLineDecorations(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
