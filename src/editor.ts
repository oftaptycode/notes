import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { Guillemets } from './guillemets';
import { markdownFormatting } from './markdown';

export interface EditorHandle {
  view: EditorView;
  getContent(): string;
  setContent(text: string): void;
  setEditable(editable: boolean): void;
  onDocChange(cb: () => void): void;
}

export function createEditor(parent: HTMLElement): EditorHandle {
  let docChangeHandler: (() => void) | null = null;
  let suppress = false;
  let editable = true;
  const editability = new Compartment();
  const editingExtensions = () => [EditorState.readOnly.of(!editable), EditorView.editable.of(editable)];

  function createState(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        editability.of(editingExtensions()),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ extensions: [GFM, Guillemets] }),
        markdownFormatting,
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { backgroundColor: 'transparent', color: 'var(--fg)', height: '100%' },
          '.cm-scroller': { fontFamily: 'inherit' },
          '.cm-content': { caretColor: 'var(--accent)' },
        }),
        EditorView.contentAttributes.of({
          'aria-label': 'Note content',
          autocapitalize: 'sentences',
          autocorrect: 'on',
          spellcheck: 'true',
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && docChangeHandler && !suppress) docChangeHandler();
        }),
      ],
    });
  }

  const view = new EditorView({
    state: createState(''),
    parent,
  });

  return {
    view,
    getContent: () => view.state.doc.toString(),
    setContent(text: string) {
      // Each document gets its own history; loading a note is not an edit.
      suppress = true;
      try {
        view.setState(createState(text));
        view.dispatch({ effects: EditorView.scrollIntoView(0) });
      } finally {
        suppress = false;
      }
    },
    setEditable(value: boolean) {
      editable = value;
      view.dispatch({ effects: editability.reconfigure(editingExtensions()) });
    },
    onDocChange(cb: () => void) {
      docChangeHandler = cb;
    },
  };
}
