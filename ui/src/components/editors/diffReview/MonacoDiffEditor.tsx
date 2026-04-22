import React, { useCallback, useRef } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';

export interface MonacoDiffEditorProps {
  snippetId: string;
  original: string;
  proposed: string;
  language: string;
  theme: string;
  sideBySide: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onSideBySideChange: (v: boolean) => void;
}

export function MonacoDiffEditor({
  snippetId: _snippetId,
  original,
  proposed,
  language,
  theme,
  sideBySide,
  onAcceptAll: _onAcceptAll,
  onRejectAll: _onRejectAll,
  onSideBySideChange: _onSideBySideChange,
}: MonacoDiffEditorProps) {
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleMount = useCallback((editor: Monaco.editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editor;
    setTimeout(() => {
      try { editor.revealFirstDiff(); } catch { /* ignore */ }
    }, 100);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        <DiffEditor
          original={original}
          modified={proposed}
          language={language}
          theme={theme}
          options={{
            renderSideBySide: sideBySide,
            originalEditable: false,
            readOnly: true,
            renderMarginRevertIcon: false,
            diffAlgorithm: 'advanced',
            ignoreTrimWhitespace: true,
            renderOverviewRuler: true,
            fontSize: 13,
            lineHeight: 20,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 4 },
          }}
          onMount={handleMount}
        />
      </div>
    </div>
  );
}

export default MonacoDiffEditor;
