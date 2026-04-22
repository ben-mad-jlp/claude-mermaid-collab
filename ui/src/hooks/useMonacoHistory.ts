import { useRef, useState, useCallback } from 'react';
import type * as Monaco from 'monaco-editor';

export interface UseMonacoHistoryReturn {
  setEditor: (editor: Monaco.editor.IStandaloneCodeEditor | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useMonacoHistory(): UseMonacoHistoryReturn {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const disposablesRef = useRef<Monaco.IDisposable[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const lastSavedVersionRef = useRef<number>(0);
  const undoVersionRef = useRef<number | null>(null);

  const setEditor = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor | null) => {
      for (const d of disposablesRef.current) {
        try { d.dispose(); } catch { /* model may already be disposed */ }
      }
      disposablesRef.current = [];
      editorRef.current = editor;

      if (!editor) {
        setCanUndo(false);
        setCanRedo(false);
        return;
      }

      const model = editor.getModel();
      if (!model) return;

      lastSavedVersionRef.current = model.getAlternativeVersionId();

      const contentDisposable = model.onDidChangeContent(() => {
        const currentVersion = model.getAlternativeVersionId();
        const hasChanges = currentVersion !== lastSavedVersionRef.current;
        setCanUndo(hasChanges);
        if (undoVersionRef.current !== null && currentVersion !== undoVersionRef.current) {
          undoVersionRef.current = null;
          setCanRedo(false);
        }
      });

      disposablesRef.current.push(contentDisposable);
    },
    [],
  );

  const undo = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !canUndo) return;
    const model = editor.getModel();
    const versionBefore = model?.getAlternativeVersionId() ?? 0;
    editor.trigger('keyboard', 'undo', null);
    setTimeout(() => {
      const versionAfter = model?.getAlternativeVersionId() ?? 0;
      if (versionAfter === versionBefore) {
        setCanUndo(false);
      }
      undoVersionRef.current = versionBefore;
      setCanRedo(true);
    }, 0);
  }, [canUndo]);

  const redo = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !canRedo) return;
    const model = editor.getModel();
    const versionBefore = model?.getAlternativeVersionId() ?? 0;
    editor.trigger('keyboard', 'redo', null);
    setTimeout(() => {
      const versionAfter = model?.getAlternativeVersionId() ?? 0;
      if (versionAfter === versionBefore) {
        setCanRedo(false);
      }
    }, 0);
  }, [canRedo]);

  return { setEditor, undo, redo, canUndo, canRedo };
}

export default useMonacoHistory;
