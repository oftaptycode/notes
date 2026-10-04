import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
const lineWrapping = EditorView.lineWrapping;
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { mdHighlightStyle, markdownLinePlugin } from './mdHighlight';

export interface EditorHandle {
  view: EditorView;
  getContent(): string;
  setContent(text: string): void;
  onDocChange(cb: () => void): void;
}

export function createEditor(parent: HTMLElement): EditorHandle {
  let docChangeHandler: (() => void) | null = null;
  let suppress = false;

  const view = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ extensions: [GFM] }),
        syntaxHighlighting(mdHighlightStyle),
        markdownLinePlugin,
        lineWrapping,
        EditorView.theme({
          '&': { backgroundColor: 'transparent', color: 'var(--fg)', height: '100%' },
          '.cm-scroller': { fontFamily: 'inherit' },
          '.cm-content': { caretColor: 'var(--accent)' },
        }),
        EditorView.contentAttributes.of({
          autocapitalize: 'sentences',
          autocorrect: 'on',
          spellcheck: 'true',
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && docChangeHandler && !suppress) docChangeHandler();
        }),
      ],
    }),
    parent,
  });

  return {
    view,
    getContent: () => view.state.doc.toString(),
    setContent(text: string) {
      suppress = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        effects: EditorView.scrollIntoView(0),
      });
      suppress = false;
    },
    onDocChange(cb: () => void) {
      docChangeHandler = cb;
    },
  };
}
