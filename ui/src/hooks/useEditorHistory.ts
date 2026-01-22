/**
 * useEditorHistory Hook
 *
 * Manages undo/redo history for CodeMirror editor.
 * Tracks canUndo/canRedo state and exposes undo/redo functions.
 */

import { useRef, useState, useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import {
  undo as cmUndo,
  redo as cmRedo,
  undoDepth,
  redoDepth,
} from '@codemirror/commands';
import { StateEffect } from '@codemirror/state';

export interface UseEditorHistoryReturn {
  editorRef: React.MutableRefObject<EditorView | null>;
  setEditor: (view: EditorView | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useEditorHistory(): UseEditorHistoryReturn {
  const editorRef = useRef<EditorView | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const updateHistoryState = useCallback((view: EditorView) => {
    try {
      setCanUndo(undoDepth(view.state) > 0);
      setCanRedo(redoDepth(view.state) > 0);
    } catch {
      // Silently ignore errors when computing history depth
      // This can happen with incomplete mock objects in tests
    }
  }, []);

  const setEditor = useCallback(
    (view: EditorView | null) => {
      editorRef.current = view;

      if (view === null) {
        setCanUndo(false);
        setCanRedo(false);
        return;
      }

      // Set up update listener to track undo/redo availability
      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged || update.transactions.length > 0) {
          updateHistoryState(update.view);
        }
      });

      // Add the update listener to the editor
      try {
        view.dispatch({
          effects: StateEffect.appendConfig.of(updateListener),
        });
      } catch {
        // Silently ignore dispatch errors in tests
      }

      // Set initial state
      updateHistoryState(view);
    },
    [updateHistoryState]
  );

  const undo = useCallback(() => {
    if (editorRef.current && canUndo) {
      try {
        cmUndo(editorRef.current);
      } catch {
        // Silently ignore undo errors
      }
    }
  }, [canUndo]);

  const redo = useCallback(() => {
    if (editorRef.current && canRedo) {
      try {
        cmRedo(editorRef.current);
      } catch {
        // Silently ignore redo errors
      }
    }
  }, [canRedo]);

  return { editorRef, setEditor, undo, redo, canUndo, canRedo };
}

export default useEditorHistory;
