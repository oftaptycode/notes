import { expect, it } from 'vitest';
import { undo, undoDepth } from '@codemirror/commands';
import { createEditor } from '../src/editor';

it('keeps Undo inside the current note and resets it when switching notes', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createEditor(host);
  try {
    editor.setContent('note A');
    editor.view.dispatch({ changes: { from: 6, insert: ' edited' } });
    expect(undo(editor.view)).toBe(true);
    expect(editor.getContent()).toBe('note A');
    editor.view.dispatch({ changes: { from: 6, insert: ' edited again' } });
    expect(undoDepth(editor.view.state)).toBeGreaterThan(0);
    editor.setContent('note B');
    expect(undoDepth(editor.view.state)).toBe(0);
    expect(undo(editor.view)).toBe(false);
    expect(editor.getContent()).toBe('note B');
  } finally {
    editor.view.destroy();
    host.remove();
  }
});
