import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { HunkOverlay } from './HunkOverlay';
import { acceptHunk, rejectHunk } from './hunkUtils';

export interface MonacoDiffEditorProps {
  snippetId: string;
  original: string;
  proposed: string;
  language: string;
  theme: string;
  observeMode: boolean;
  sideBySide: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptHunk: (hunkIndex: number, comment?: string) => void;
  onRejectHunk: (hunkIndex: number, comment?: string) => void;
  onSideBySideChange: (v: boolean) => void;
  onObserveModeChange: (v: boolean) => void;
  /** Called whenever lineChanges or currentHunk changes so parent can render toolbar */
  onHunkChange?: (currentHunk: number, total: number) => void;
}

export interface MonacoDiffEditorHandle {
  getCurrentModifiedContent: () => string;
  revealHunk: (index: number) => void;
  prevHunk: () => void;
  nextHunk: () => void;
}

export const MonacoDiffEditor = React.forwardRef<MonacoDiffEditorHandle, MonacoDiffEditorProps>(
  (
    {
      snippetId,
      original,
      proposed,
      language,
      theme,
      observeMode,
      sideBySide,
      onAcceptAll,
      onRejectAll,
      onAcceptHunk,
      onRejectHunk,
      onSideBySideChange,
      onObserveModeChange,
      onHunkChange,
    },
    ref,
  ) => {
    const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [lineChanges, setLineChanges] = useState<Monaco.editor.ILineChange[]>([]);
    const lineChangesRef = useRef<Monaco.editor.ILineChange[]>([]);
    const [currentHunk, setCurrentHunk] = useState(0);
    const [editorMounted, setEditorMounted] = useState(false);

    // Keep lineChangesRef in sync and notify parent of hunk state changes
    useEffect(() => {
      lineChangesRef.current = lineChanges;
      onHunkChange?.(currentHunk, lineChanges.length);
    }, [lineChanges, currentHunk, onHunkChange]);

    const revealHunkLine = useCallback((index: number) => {
      const changes = lineChangesRef.current;
      const hunk = changes[index];
      if (!hunk) return;
      const lineNumber = hunk.modifiedStartLineNumber > 0 ? hunk.modifiedStartLineNumber : hunk.modifiedEndLineNumber;
      if (lineNumber > 0) diffEditorRef.current?.getModifiedEditor().revealLineInCenter(lineNumber);
    }, []);

    React.useImperativeHandle(ref, () => ({
      getCurrentModifiedContent: () =>
        diffEditorRef.current?.getModifiedEditor().getModel()?.getValue() ?? proposed,
      revealHunk: revealHunkLine,
      prevHunk: () => {
        setCurrentHunk((prev) => {
          const next = Math.max(0, prev - 1);
          revealHunkLine(next);
          return next;
        });
      },
      nextHunk: () => {
        setCurrentHunk((prev) => {
          const next = Math.min(lineChangesRef.current.length - 1, prev + 1);
          revealHunkLine(next);
          return next;
        });
      },
    }));

    const handleMount = useCallback(
      (editor: Monaco.editor.IStandaloneDiffEditor) => {
        diffEditorRef.current = editor;
        editor.onDidUpdateDiff(() => {
          setLineChanges(editor.getLineChanges() ?? []);
        });
        setTimeout(() => {
          try { editor.revealFirstDiff(); } catch { /* ignore */ }
        }, 100);
        setEditorMounted(true);
      },
      [],
    );

    const handleAcceptHunkLocal = useCallback(
      (index: number, comment?: string) => {
        const diffEditor = diffEditorRef.current;
        const change = lineChangesRef.current[index];
        if (diffEditor && change) {
          acceptHunk(diffEditor, change);
          // After accepting, the model updates and onDidUpdateDiff fires again
        }
        onAcceptHunk(index, comment);
        setCurrentHunk((prev) => Math.min(prev + 1, Math.max(0, lineChangesRef.current.length - 1)));
      },
      [onAcceptHunk],
    );

    const handleRejectHunkLocal = useCallback(
      (index: number, comment?: string) => {
        const diffEditor = diffEditorRef.current;
        const change = lineChangesRef.current[index];
        if (diffEditor && change) {
          rejectHunk(diffEditor, change);
        }
        onRejectHunk(index, comment);
        setCurrentHunk((prev) => Math.min(prev + 1, Math.max(0, lineChangesRef.current.length - 1)));
      },
      [onRejectHunk],
    );

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
              readOnly: observeMode,
              renderMarginRevertIcon: true,
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
          {editorMounted && (
            <HunkOverlay
              diffEditorRef={diffEditorRef as React.RefObject<Monaco.editor.IStandaloneDiffEditor>}
              containerRef={containerRef as React.RefObject<HTMLDivElement>}
              lineChanges={lineChanges}
              observeMode={observeMode}
              onAcceptHunk={handleAcceptHunkLocal}
              onRejectHunk={handleRejectHunkLocal}
            />
          )}
        </div>
      </div>
    );
  },
);

MonacoDiffEditor.displayName = 'MonacoDiffEditor';

export default MonacoDiffEditor;
