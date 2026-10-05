import type { MarkdownConfig } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate, type DecorationSet } from '@codemirror/view';
import { Range } from '@codemirror/state';
import type { SyntaxNodeRef } from '@lezer/common';

// Inline custom delimiter: «text» is guillemet-quoted text.
const GuillemetDelim = { resolve: 'Guillemet', mark: 'GuillemetMark' };

export const Guillemets: MarkdownConfig = {
  defineNodes: [{ name: 'Guillemet' }, { name: 'GuillemetMark' }],
  parseInline: [
    {
      name: 'Guillemets',
      parse(cx, next, pos) {
        if (next === 171 /* '«' */) {
          return cx.addDelimiter(GuillemetDelim, pos, pos + 1, true, false);
        }
        if (next === 187 /* '»' */) {
          return cx.addDelimiter(GuillemetDelim, pos, pos + 1, false, true);
        }
        return -1;
      },
      after: 'Emphasis',
    },
  ],
};

function build(state: EditorView['state']): DecorationSet {
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      if (node.name === 'Guillemet') {
        out.push(Decoration.mark({ class: 'gq-text' }).range(node.from, node.to));
      } else if (node.name === 'GuillemetMark') {
        out.push(Decoration.mark({ class: 'gq-mark' }).range(node.from, node.to));
      }
    },
  });
  return Decoration.set(out, true);
}

export const guillemetPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.transactions.length > 0) {
        this.decorations = build(u.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
