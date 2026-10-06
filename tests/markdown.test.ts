import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { Guillemets } from '../src/guillemets';
import { markdownDecorations } from '../src/markdown';

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
