import { syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
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
  blocks: Block[];
  references: Map<string, LinkTarget>;
}
interface LinkTarget {
  url: string;
  title: string;
}
interface Block {
  from: number;
  to: number;
  tree: Tree;
  definitions: [string, LinkTarget][];
  referenceLinks: boolean;
}

const referenceKey = (label: string) => label.trim().replace(/\s+/g, ' ').toUpperCase();

function linkTarget(state: EditorState, node: SyntaxNode, offset: number): LinkTarget {
  const url = node.getChild('URL');
  const title = node.getChild('LinkTitle');
  return {
    url: url ? state.sliceDoc(offset + url.from, offset + url.to).replace(/^<|>$/g, '') : '',
    title: title ? state.sliceDoc(offset + title.from + 1, offset + title.to - 1) : '',
  };
}

function readBlock(state: EditorState, tree: Tree, from: number): Block {
  const block: Block = { from, to: from + tree.length, tree, definitions: [], referenceLinks: false };
  block.tree.iterate({
    enter(ref) {
      if (ref.name === 'LinkReference') {
        const label = ref.node.getChild('LinkLabel');
        if (label) block.definitions.push([
          referenceKey(state.sliceDoc(block.from + label.from + 1, block.from + label.to - 1)),
          linkTarget(state, ref.node, block.from),
        ]);
      }
      if (ref.name === 'Link' && !ref.node.getChildren('LinkMark')
        .some(mark => state.sliceDoc(block.from + mark.from, block.from + mark.to) === '(')) {
        block.referenceLinks = true;
      }
    },
  });
  return block;
}

function formatBlock(state: EditorState, block: Block, references: Map<string, LinkTarget>) {
  const marks: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const lines = new Map<number, Set<string>>();
  const links: SyntaxNode[] = [];
  const text = (node: SyntaxNode) => state.sliceDoc(block.from + node.from, block.from + node.to);

  function hide(from: number, to: number) {
    if (from < to) hidden.push(Decoration.replace({}).range(block.from + from, block.from + to));
  }
  function lineStyle(from: number, to: number, cls: string) {
    from += block.from;
    to += block.from;
    const end = state.doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = state.doc.lineAt(from).number; n <= end; n++) {
      const start = state.doc.line(n).from;
      if (!lines.has(start)) lines.set(start, new Set());
      lines.get(start)!.add(cls);
    }
  }
  block.tree.iterate({
    enter(ref) {
      const node = ref.node;
      const heading = HEADINGS[node.name];
      if (heading) lineStyle(node.from, node.to, heading);
      if (node.name === 'Blockquote') lineStyle(node.from, node.to, 'md-quote');
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') lineStyle(node.from, node.to, 'md-codeblock');
      if (node.name === 'HorizontalRule') lineStyle(node.from, node.to, 'md-hr');
      if (node.name === 'ListItem') lineStyle(node.from, state.doc.lineAt(block.from + node.from).to - block.from, 'md-list');

      if (HIDDEN_MARKERS.has(node.name)) {
        let to = node.to;
        if (LEADING_MARKERS.has(node.name) && state.sliceDoc(block.from + to, block.from + to + 1) === ' ') to++;
        hide(node.from, to);
      }
      if (node.name === 'Guillemet' || node.name === 'GuillemetMark') {
        marks.push(Decoration.mark({ class: node.name === 'Guillemet' ? 'gq-text' : 'gq-mark' })
          .range(block.from + node.from, block.from + node.to));
      }
      if (node.name === 'Link') links.push(node);
      if (node.name === 'LinkReference') {
        const label = node.getChild('LinkLabel');
        if (label) {
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
    const reference = label ? state.sliceDoc(block.from + label.from + 1, block.from + label.to - 1) : '';
    const name = reference || state.sliceDoc(block.from + opening.to, block.from + closing.from);
    const destination = inline ? linkTarget(state, link, block.from) : references.get(referenceKey(name));

    // Lezer also calls unresolved [text] and [text][missing] "Link" nodes.
    // They are literal brackets, not formatting: add no wrapper or CSS reset.
    if (!destination) continue;
    hide(opening.from, opening.to);
    hide(closing.from, link.to); // Includes the URL, optional title and reference label.
    if (opening.to < closing.from) {
      marks.push(Decoration.mark({
        class: 'md-link',
        attributes: { title: destination.title || destination.url },
      }).range(block.from + opening.to, block.from + closing.from));
    }
  }

  for (const [from, classes] of lines) {
    marks.push(Decoration.line({ class: [...classes].join(' ') }).range(from));
  }
  return { marks, hidden };
}

function buildFormatting(state: EditorState, previous?: Formatting, transaction?: Transaction): Formatting {
  // Lezer reuses unchanged top-level block trees. Inspect their identities, not
  // every inline node/decoration, and keep their existing mapped ranges intact.
  const oldBlocks = new Map(previous?.blocks.map(block => [block.tree, block]));
  const blocks: Block[] = [];
  const reused = new Set<Tree>();
  const dirty = new Set<Block>();
  function addBlock(tree: Tree, from: number) {
    const old = oldBlocks.get(tree);
    const block = old ? { ...old, from, to: from + tree.length } : readBlock(state, tree, from);
    blocks.push(block);
    if (old) reused.add(block.tree);
    else dirty.add(block);
  }
  const tree = syntaxTree(state);
  // Skip anonymous balancing groups, whose shape can change even when their
  // actual paragraphs are reused. Markdown blocks themselves are unbuffered.
  function collect(parent: Tree, offset: number): boolean {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (!('type' in child)) return false;
      const from = offset + parent.positions[i];
      if (child.type.isAnonymous) {
        if (!collect(child, from)) return false;
      } else addBlock(child, from);
    }
    return true;
  }
  if (!collect(tree, 0)) {
    blocks.length = 0;
    reused.clear();
    dirty.clear();
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) addBlock(node.toTree(), node.from);
  }
  const references = new Map<string, LinkTarget>();
  for (const block of blocks) {
    for (const [key, target] of block.definitions) if (!references.has(key)) references.set(key, target);
  }
  const changedReferences = !previous || references.size !== previous.references.size
    || [...references].some(([key, value]) => {
      const old = previous.references.get(key);
      return old?.url !== value.url || old?.title !== value.title;
    });
  if (changedReferences) for (const block of blocks) if (block.referenceLinks) dirty.add(block);

  const invalid: { from: number; to: number }[] = [];
  for (const old of previous?.blocks ?? []) {
    if (reused.has(old.tree)) continue;
    // An indented heading/quote can start after the beginning of its line,
    // while its line decoration lives at column zero. Invalidate that too.
    const lineFrom = (transaction?.startState ?? state).doc.lineAt(old.from).from;
    const from = transaction ? transaction.changes.mapPos(lineFrom, 1) : lineFrom;
    const to = transaction ? transaction.changes.mapPos(old.to, -1) : old.to;
    invalid.push({ from: Math.min(from, to), to: Math.max(from, to) });
  }
  function mergeRanges(input: typeof invalid) {
    input.sort((a, b) => a.from - b.from);
    const result: typeof invalid = [];
    for (const range of input) {
      const last = result[result.length - 1];
      if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
      else result.push({ ...range });
    }
    return result;
  }
  const removed = mergeRanges(invalid);
  // A removed block can map to the first line of a surviving block. Rebuild that
  // neighbor too, so removing stale line decorations cannot remove its style.
  let rangeIndex = 0;
  for (const block of blocks) {
    while (rangeIndex < removed.length && removed[rangeIndex].to < block.from) rangeIndex++;
    for (let i = rangeIndex; i < removed.length && removed[i].from <= block.to; i++) {
      const range = removed[i];
      if (range.from === range.to
        ? block.from <= range.from && block.to >= range.to
        : block.from < range.to && block.to > range.from) {
        dirty.add(block);
        break;
      }
    }
  }
  for (const block of dirty) invalid.push({ from: state.doc.lineAt(block.from).from, to: block.to });
  const ranges = mergeRanges(invalid);
  const marks: Range<Decoration>[] = [], hidden: Range<Decoration>[] = [];
  for (const block of dirty) {
    const formatted = formatBlock(state, block, references);
    marks.push(...formatted.marks);
    hidden.push(...formatted.hidden);
  }
  const mapped = (set: DecorationSet) => transaction ? set.map(transaction.changes) : set;
  const update = (set: DecorationSet, add: Range<Decoration>[]) => {
    if (!ranges.length) return mapped(set);
    return mapped(set).update({
      filterFrom: ranges[0].from, filterTo: ranges[ranges.length - 1].to,
      filter(from) {
        // Ranges are disjoint and sorted; references may invalidate distant blocks.
        let low = 0, high = ranges.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (ranges[mid].from <= from) low = mid + 1;
          else high = mid;
        }
        const range = ranges[low - 1];
        return !range || from > range.to || (from === range.to && range.from < range.to);
      },
      add, sort: true,
    });
  };
  return {
    decorations: update(previous?.decorations ?? Decoration.none, [...marks, ...hidden]),
    hidden: update(previous?.hidden ?? Decoration.none, hidden), blocks, references,
  };
}

// Direct state decorations can safely hide multiline link destinations/titles.
// View-plugin decorations cannot replace ranges containing line breaks.
export const markdownDecorations = StateField.define<Formatting>({
  create: state => buildFormatting(state),
  update(value, transaction) {
    return transaction.docChanged || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? buildFormatting(transaction.state, value, transaction)
      : value;
  },
  provide: field => [
    EditorView.decorations.from(field, value => value.decorations),
    EditorView.atomicRanges.of(view => view.state.field(field).hidden),
  ],
});

export const markdownFormatting = [syntaxHighlighting(mdHighlightStyle), markdownDecorations];
