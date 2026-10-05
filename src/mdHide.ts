import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate, type DecorationSet } from '@codemirror/view';
import { EditorState, type Range } from '@codemirror/state';
import type { SyntaxNodeRef } from '@lezer/common';

// Nodes whose characters are invisible in the editor (formatting only).
const HIDDEN = new Set([
  'HeaderMark',      // # ## ###
  'QuoteMark',       // >
  'ListMark',        // - * + 1.
  'TaskMarker',      // [ ] [x]
  'EmphasisMark',    // * _
  'StrikethroughMark',
  'CodeMark',        // ` and ``` fences
  'CodeInfo',        // language name after ```
  'HorizontalRule',  // --- rendered as a line below
  'LinkMark',        // [ ] ( )
  'URL',             // link target
]);

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      if (!HIDDEN.has(node.name)) return;

      // Bracketed text without (url) — like [sic] — is NOT a real link;
      // leave those brackets visible.
      if (node.name === 'LinkMark' || node.name === 'URL') {
        let p: typeof node.node | null = node.node.parent;
        while (p && p.name !== 'Link') p = p.parent;
        if (!p) return;
        if (!p.getChild('URL')) return;
      }

      let to = node.to;
      // Eat one following space for line-leading markers ("# ", "> ", "- ")
      if (node.name === 'HeaderMark' || node.name === 'QuoteMark' || node.name === 'ListMark') {
        const ch = state.sliceDoc(to, to + 1);
        if (ch === ' ') to += 1;
      }
      out.push(Decoration.replace({}).range(node.from, to));
    },
  });
  return Decoration.set(out, true);
}

export const hideMarkersPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
        this.decorations = build(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
