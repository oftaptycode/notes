import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { Guillemets } from '../src/guillemets';
import { markdownDecorations } from '../src/markdown';
import { ensureSyntaxTree } from '@codemirror/language';

const stateFor = (doc: string) => EditorState.create({
  doc, extensions: [markdown({ extensions: [GFM, Guillemets] }), markdownDecorations],
});
function visibleText(state: EditorState) {
  let visible = '', cursor = 0;
  state.field(markdownDecorations).hidden.between(0, state.doc.length, (from, to) => {
    visible += state.sliceDoc(cursor, from);
    cursor = to;
  });
  return (visible + state.sliceDoc(cursor)).trim();
}

it('distinguishes literal brackets from inline and resolved reference links', () => {
  for (const [source, expected] of [
    ['[] [sic] [**bold**] [*italic*] [unfinished', '[] [sic] [bold] [italic] [unfinished'],
    ['[label][missing]', '[label][missing]'],
    ['[label](https://example.com "title")', 'label'],
    ['[label]()', 'label'],
    ['[multi](\n<https://example.com>\n"title"\n)', 'multi'],
    ['[**label**][ID]\n\n[id]: https://example.com', 'label'],
    ['[id][] and [id]\n\n[id]: https://example.com', 'id and id'],
  ]) {
    const state = stateFor(source);
    expect(visibleText(state), source).toBe(expected);
    expect(state.doc.toString()).toBe(source);
  }
  const initial = stateFor('[label][id]');
  const resolved = initial.update({ changes: { from: initial.doc.length, insert: '\n\n[id]: https://example.com' } }).state;
  expect(visibleText(resolved)).toBe('label');
});

it('preserves custom guillemets and literal code content without rescanning cursor moves', () => {
  const source = '«**custom**» and `[literal *code*]`';
  const state = stateFor(source);
  expect(visibleText(state)).toBe('«custom» and [literal *code*]');
  const classes: string[] = [];
  state.field(markdownDecorations).decorations.between(0, source.length, (_from, _to, decoration) => {
    if (decoration.spec.class) classes.push(decoration.spec.class);
  });
  expect(classes).toContain('gq-text');
  expect(classes.filter(cls => cls === 'gq-mark')).toHaveLength(2);
  const moved = state.update({ selection: { anchor: 4 } }).state;
  expect(moved.field(markdownDecorations)).toBe(state.field(markdownDecorations));
  expect(moved.doc.toString()).toBe(source);
});

function fullyParsed(state: EditorState) {
  expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
  return state.update({}).state;
}

function decorations(state: EditorState) {
  const result: string[] = [];
  state.field(markdownDecorations).decorations.between(0, state.doc.length, (from, to, value) => {
    result.push(JSON.stringify([from, to, value.spec]));
  });
  return result.sort();
}

it('matches a fresh full rebuild through structural edits, reference changes and block deletion', () => {
  let state = fullyParsed(stateFor([
    '# Heading', '', 'Paragraph **bold** «custom» [ref][id].', '',
    '> quoted', '> nested **strong**', '', '- list', '- second', '',
    '```js', 'let x = 1;', '```', '', '[id]: https://old.example "old"', '',
    'Trailing [ref][id] and [inline](\n<https://example.com>\n"title"\n)',
  ].join('\n')));
  const edit = (from: number, to: number, insert: string) => {
    state = fullyParsed(state.update({ changes: { from, to, insert } }).state);
    expect(decorations(state)).toEqual(decorations(fullyParsed(stateFor(state.doc.toString()))));
  };
  let text = state.doc.toString();
  let from = text.indexOf('https://old.example');
  edit(from, from + 'https://old.example'.length, 'https://new.example');
  text = state.doc.toString();
  from = text.indexOf('[id]:');
  edit(from, text.indexOf('\n\n', from) + 2, ''); // Unresolve distant links.
  edit(0, 0, '[ID]: https://first.example\n\n');
  edit(state.doc.length, state.doc.length, '\n\n[id]: https://duplicate.example');
  text = state.doc.toString();
  from = text.indexOf('```js');
  edit(from, from + 5, ''); // Opening/closing fences change subsequent block structure.
  edit(0, state.doc.toString().indexOf('Paragraph'), '');
  edit(state.doc.length - 12, state.doc.length, '\n\n## Final');
  edit(0, state.doc.length, '');
  edit(0, 0, '> restored\n\n**bold**');
});

it('keeps unchanged decorations and handles deterministic edits at arbitrary block boundaries', () => {
  let state = fullyParsed(stateFor(('# Heading\n\nParagraph **bold** and [ref][id].\n\n').repeat(12)
    + '[id]: https://example.com'));
  const original: unknown[] = [];
  state.field(markdownDecorations).decorations.between(300, 400, (_from, _to, value) => original.push(value));
  state = fullyParsed(state.update({ changes: { from: 15, insert: 'x' } }).state);
  const updated: unknown[] = [];
  state.field(markdownDecorations).decorations.between(301, 401, (_from, _to, value) => updated.push(value));
  expect(updated).toEqual(original);
  expect(updated[0]).toBe(original[0]);
  let seed = 12345;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const inserts = ['\n', '\n\n', '# ', '> ', '**', '[id]: https://new.example\n', '```\n', '', '«x»'];
  for (let i = 0; i < 60; i++) {
    const from = random() % (state.doc.length + 1);
    const to = Math.min(state.doc.length, from + random() % 30);
    state = fullyParsed(state.update({ changes: { from, to, insert: inserts[random() % inserts.length] } }).state);
    expect(decorations(state), `edit ${i}`).toEqual(decorations(fullyParsed(stateFor(state.doc.toString()))));
  }
});

it('handles indented blocks and background parse completion in a large document', () => {
  let state = fullyParsed(stateFor(('   # Indented\n\n    code\n    code\n\n  > quote\n\n**bold**\n\n').repeat(200)));
  for (const changes of [
    { from: 3, to: 5, insert: '' },
    { from: 15, to: 20, insert: '\n## inserted\n' },
    { from: 5000, to: 6000, insert: '> replacement\n\n' },
    { from: 0, to: 25, insert: 'plain\n\n' },
  ]) {
    state = fullyParsed(state.update({ changes }).state);
    expect(decorations(state)).toEqual(decorations(fullyParsed(stateFor(state.doc.toString()))));
  }
});
