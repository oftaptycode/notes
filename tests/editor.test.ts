import { expect, it, vi } from 'vitest';
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

it('toggles redaction without changing focus, selection, or content', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const toggle = vi.fn();
  const onChange = vi.fn();
  const editor = createEditor(host, toggle);
  try {
    editor.setContent('note text');
    editor.onDocChange(onChange);
    editor.view.dispatch({ selection: { anchor: 2, head: 5 } });
    editor.view.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'x', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    });
    editor.view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(toggle).toHaveBeenCalledOnce();
    expect(editor.view.hasFocus).toBe(true);
    expect(editor.view.state.selection.main).toMatchObject({ anchor: 2, head: 5 });
    expect(editor.getContent()).toBe('note text');
    expect(onChange).not.toHaveBeenCalled();

    editor.setContent('another note');
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'x', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    expect(toggle).toHaveBeenCalledTimes(2);
  } finally {
    editor.view.destroy();
    host.remove();
  }
});
