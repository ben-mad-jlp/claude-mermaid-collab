import type * as Monaco from 'monaco-editor';

function rectFromPosition(
  editor: Monaco.editor.IStandaloneCodeEditor,
  position: Monaco.IPosition,
): DOMRect {
  const coords = editor.getScrolledVisiblePosition(position);
  const domNode = editor.getDomNode();
  if (!coords || !domNode) {
    return new DOMRect(0, 0, 0, 0);
  }
  const editorRect = domNode.getBoundingClientRect();
  return new DOMRect(
    editorRect.left + coords.left,
    editorRect.top + coords.top,
    0,
    coords.height,
  );
}

export function registerSymbolNav(
  editor: Monaco.editor.IStandaloneCodeEditor,
  onSymbolClick?: (symbol: string, rect: DOMRect) => void,
  onSymbolGoToDefinition?: (symbol: string, rect: DOMRect) => void,
): Monaco.IDisposable[] {
  const disposables: Monaco.IDisposable[] = [];

  disposables.push(
    editor.onMouseDown((e) => {
      const position = e.target.position;
      if (!position) return;

      const isModifier = e.event.metaKey || e.event.ctrlKey;

      if (isModifier && onSymbolGoToDefinition) {
        const model = editor.getModel();
        if (!model) return;
        const word = model.getWordAtPosition(position);
        if (!word) return;
        e.event.preventDefault();
        const rect = rectFromPosition(editor, position);
        onSymbolGoToDefinition(word.word, rect);
        return;
      }

      if (!isModifier && onSymbolClick) {
        const model = editor.getModel();
        if (!model) return;
        const word = model.getWordAtPosition(position);
        if (!word) return;
        const rect = rectFromPosition(editor, position);
        onSymbolClick(word.word, rect);
      }
    }),
  );

  if (onSymbolGoToDefinition) {
    disposables.push(
      editor.onContextMenu((e) => {
        const position = e.target.position;
        if (!position) return;
        const model = editor.getModel();
        if (!model) return;
        const word = model.getWordAtPosition(position);
        if (!word) return;
        e.event.preventDefault();
        const rect = rectFromPosition(editor, position);
        onSymbolGoToDefinition(word.word, rect);
      }),
    );
  }

  return disposables;
}
