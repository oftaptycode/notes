import { syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { mdHighlightStyle } from './mdHighlight';

const HEADINGS: Record<string, string> = {
  ATXHeading1: 'md-h1', ATXHeading2: 'md-h2', ATXHeading3: 'md-h3',
  ATXHeading4: 'md-h4', ATXHeading5: 'md-h5', ATXHeading6: 'md-h6',
  SetextHeading1: 'md-h1', SetextHeading2: 'md-h2',
};
const HIDDEN_MARKERS = new Set([
  // ListMark and TaskMarker stay visible, including their following whitespace.
  'HeaderMark', 'QuoteMark', 'EmphasisMark',
  'StrikethroughMark', 'CodeMark', 'CodeInfo', 'HorizontalRule',
]);
const LEADING_MARKERS = new Set(['HeaderMark', 'QuoteMark']);

interface Formatting {
  decorations: DecorationSet;
  hidden: DecorationSet;
}
interface LinkTarget {
  url: string;
  title: string;
}

const referenceKey = (label: string) => label.trim().replace(/\s+/g, ' ').toUpperCase();

function buildFormatting(state: EditorState): Formatting {
  const marks: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const lines = new Map<number, Set<string>>();
  const references = new Map<string, LinkTarget>();
  const links: SyntaxNode[] = [];
  const text = (node: SyntaxNode) => state.sliceDoc(node.from, node.to);

  function hide(from: number, to: number) {
    if (from < to) hidden.push(Decoration.replace({}).range(from, to));
  }
  function lineStyle(from: number, to: number, cls: string) {
    const end = state.doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = state.doc.lineAt(from).number; n <= end; n++) {
      const start = state.doc.line(n).from;
      if (!lines.has(start)) lines.set(start, new Set());
      lines.get(start)!.add(cls);
    }
  }
  function target(node: SyntaxNode): LinkTarget {
    const url = node.getChild('URL');
    const title = node.getChild('LinkTitle');
    return {
      url: url ? text(url).replace(/^<|>$/g, '') : '',
      title: title ? state.sliceDoc(title.from + 1, title.to - 1) : '',
    };
  }

  // One traversal for all structural styles, hidden syntax and custom guillemets.
  // Resolve links afterwards so definitions can appear anywhere in the document.
  syntaxTree(state).iterate({
    enter(ref) {
      const node = ref.node;
      const heading = HEADINGS[node.name];
      if (heading) lineStyle(node.from, node.to, heading);
      if (node.name === 'Blockquote') lineStyle(node.from, node.to, 'md-quote');
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') lineStyle(node.from, node.to, 'md-codeblock');
      if (node.name === 'HorizontalRule') lineStyle(node.from, node.to, 'md-hr');
      if (node.name === 'ListItem') lineStyle(node.from, state.doc.lineAt(node.from).to, 'md-list');

      if (HIDDEN_MARKERS.has(node.name)) {
        let to = node.to;
        if (LEADING_MARKERS.has(node.name) && state.sliceDoc(to, to + 1) === ' ') to++;
        hide(node.from, to);
      }
      if (node.name === 'Guillemet' || node.name === 'GuillemetMark') {
        marks.push(Decoration.mark({ class: node.name === 'Guillemet' ? 'gq-text' : 'gq-mark' })
          .range(node.from, node.to));
      }
      if (node.name === 'Link') links.push(node);
      if (node.name === 'LinkReference') {
        const label = node.getChild('LinkLabel');
        if (label) {
          const key = referenceKey(state.sliceDoc(label.from + 1, label.to - 1));
          if (!references.has(key)) references.set(key, target(node));
          hide(node.from, node.to);
        }
      }
    },
  });

  for (const link of links) {
    const delimiters = link.getChildren('LinkMark');
    const opening = delimiters[0], closing = delimiters[1];
    if (!opening || !closing) continue;
    const inline = delimiters.some(mark => text(mark) === '(');
    const label = link.getChild('LinkLabel');
    const reference = label ? state.sliceDoc(label.from + 1, label.to - 1) : '';
    const name = reference || state.sliceDoc(opening.to, closing.from);
    const destination = inline ? target(link) : references.get(referenceKey(name));

    // Lezer also calls unresolved [text] and [text][missing] "Link" nodes.
    // They are literal brackets, not formatting: add no wrapper or CSS reset.
    if (!destination) continue;
    hide(opening.from, opening.to);
    hide(closing.from, link.to); // Includes the URL, optional title and reference label.
    if (opening.to < closing.from) {
      marks.push(Decoration.mark({
        class: 'md-link',
        attributes: { title: destination.title || destination.url },
      }).range(opening.to, closing.from));
    }
  }

  for (const [from, classes] of lines) {
    marks.push(Decoration.line({ class: [...classes].join(' ') }).range(from));
  }
  return {
    decorations: Decoration.set([...marks, ...hidden], true),
    hidden: Decoration.set(hidden, true),
  };
}

// Direct state decorations can safely hide multiline link destinations/titles.
// View-plugin decorations cannot replace ranges containing line breaks.
export const markdownDecorations = StateField.define<Formatting>({
  create: buildFormatting,
  update(value, transaction) {
    return transaction.docChanged || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? buildFormatting(transaction.state)
      : value;
  },
  provide: field => [
    EditorView.decorations.from(field, value => value.decorations),
    EditorView.atomicRanges.of(view => view.state.field(field).hidden),
  ],
});

export const markdownFormatting = [syntaxHighlighting(mdHighlightStyle), markdownDecorations];
