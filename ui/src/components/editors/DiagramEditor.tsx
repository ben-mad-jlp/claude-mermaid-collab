/**
 * DiagramEditor Component
 *
 * A full-featured diagram editor with:
 * - Split pane layout (code editor on left, live preview on right)
 * - CodeMirror for syntax editing
 * - MermaidPreview for live diagram rendering
 * - Diagram validation and error handling
 * - Save/cancel functionality with keyboard shortcuts
 * - Auto-save debouncing
 * - Loading and error states
 * - Responsive design
 *
 * The component integrates with the session store to manage diagram state
 * and provides keyboard shortcuts (Ctrl+S / Cmd+S to save).
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import CodeMirrorWrapper from './CodeMirrorWrapper';
import MermaidPreview from './MermaidPreview';
import { SplitPane } from '../layout/SplitPane';
import { useDiagram } from '@/hooks/useDiagram';
import { useSession } from '@/hooks/useSession';
import { Diagram, DiagramValidation } from '@/types';
import mermaid from 'mermaid';

export interface DiagramEditorProps {
  /** ID of the diagram to edit */
  diagramId: string;
  /** Callback when editor exits (optional) */
  onExit?: () => void;
}

interface EditorState {
  isLoading: boolean;
  error: string | null;
  isValidating: boolean;
  validation: DiagramValidation | null;
  isSaving: boolean;
  hasChanges: boolean;
  lastSavedAt: number | null;
}

/**
 * DiagramEditor Component
 *
 * Full-featured diagram editor with split pane layout,
 * live preview, validation, and keyboard shortcuts.
 *
 * @example
 * ```tsx
 * function MyApp() {
 *   return (
 *     <DiagramEditor
 *       diagramId="diagram-123"
 *       onExit={() => navigate('/')}
 *     />
 *   );
 * }
 * ```
 */
export const DiagramEditor: React.FC<DiagramEditorProps> = ({
  diagramId,
  onExit,
}) => {
  // Get diagram from store
  const { getDiagramById, updateDiagram } = useDiagram();
  const { currentSession } = useSession();

  // Local state
  const diagram = getDiagramById(diagramId);
  const [editorContent, setEditorContent] = useState<string>(diagram?.content ?? '');
  const [editorState, setEditorState] = useState<EditorState>({
    isLoading: !diagram,
    error: null,
    isValidating: false,
    validation: null,
    isSaving: false,
    hasChanges: false,
    lastSavedAt: null,
  });

  // Auto-load diagram if not already loaded
  useEffect(() => {
    if (diagram) {
      setEditorContent(diagram.content);
      setEditorState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [diagram]);

  // Validate diagram using Mermaid
  const validateContent = useCallback(
    async (content: string) => {
      setEditorState((prev) => ({ ...prev, isValidating: true }));
      try {
        // Trim content
        const trimmedContent = content.trim();

        // Empty content is valid (user just hasn't written anything yet)
        if (!trimmedContent) {
          setEditorState((prev) => ({
            ...prev,
            isValidating: false,
            validation: { valid: true },
          }));
          return;
        }

        // Try to parse the diagram with mermaid
        await mermaid.parse(trimmedContent);

        setEditorState((prev) => ({
          ...prev,
          isValidating: false,
          validation: { valid: true },
        }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid diagram syntax';
        setEditorState((prev) => ({
          ...prev,
          isValidating: false,
          validation: {
            valid: false,
            error: errorMessage,
          },
        }));
      }
    },
    []
  );

  // Debounce validation with useEffect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (editorContent !== diagram?.content) {
        validateContent(editorContent);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [editorContent, diagram?.content, validateContent]);

  // Handle editor changes
  const handleEditorChange = useCallback((newContent: string) => {
    setEditorContent(newContent);
    setEditorState((prev) => ({
      ...prev,
      hasChanges: newContent !== diagram?.content,
    }));
  }, [diagram?.content]);

  // Save diagram
  const handleSave = useCallback(async () => {
    if (!diagram || !editorState.validation?.valid) {
      setEditorState((prev) => ({
        ...prev,
        error: 'Cannot save invalid diagram',
      }));
      return;
    }

    setEditorState((prev) => ({ ...prev, isSaving: true, error: null }));
    try {
      // Update in store
      updateDiagram(diagram.id, {
        content: editorContent,
        lastModified: Date.now(),
      });

      setEditorState((prev) => ({
        ...prev,
        isSaving: false,
        hasChanges: false,
        lastSavedAt: Date.now(),
      }));

      // Show success message
      setTimeout(() => {
        setEditorState((prev) => ({ ...prev, lastSavedAt: null }));
      }, 2000);
    } catch (error) {
      setEditorState((prev) => ({
        ...prev,
        isSaving: false,
        error: error instanceof Error ? error.message : 'Failed to save diagram',
      }));
    }
  }, [diagram, editorContent, editorState.validation?.valid, updateDiagram]);

  // Handle discard changes
  const handleDiscard = useCallback(() => {
    if (diagram) {
      setEditorContent(diagram.content);
      setEditorState((prev) => ({
        ...prev,
        hasChanges: false,
        error: null,
      }));
    }
  }, [diagram]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+S or Ctrl+S to save
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (editorState.hasChanges && editorState.validation?.valid) {
          handleSave();
        }
      }
      // Escape to exit
      if (event.key === 'Escape' && !editorState.hasChanges) {
        onExit?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editorState.hasChanges, editorState.validation?.valid, handleSave, onExit]);

  // Loading state
  if (editorState.isLoading || !diagram) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading diagram...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header with title and controls */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            {diagram.name}
          </h1>
          {editorState.hasChanges && (
            <span className="inline-block w-2 h-2 rounded-full bg-orange-400" title="Unsaved changes" />
          )}
          {editorState.lastSavedAt && (
            <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {editorState.error && (
            <div className="text-xs text-red-600 dark:text-red-400">
              {editorState.error}
            </div>
          )}
          <button
            onClick={handleDiscard}
            disabled={!editorState.hasChanges || editorState.isSaving}
            className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            title="Discard changes (Esc)"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={!editorState.hasChanges || !editorState.validation?.valid || editorState.isSaving}
            className="px-3 py-2 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            title="Save diagram (Cmd+S / Ctrl+S)"
          >
            {editorState.isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Split pane with editor and preview */}
      <div className="flex-1 overflow-hidden">
        <SplitPane
          direction="horizontal"
          defaultPrimarySize={50}
          minPrimarySize={20}
          minSecondarySize={20}
          storageId="diagram-editor-split"
          primaryContent={
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-hidden">
                <CodeMirrorWrapper
                  value={editorContent}
                  onChange={handleEditorChange}
                  language="yaml"
                  height="100%"
                  placeholder="Enter Mermaid diagram syntax..."
                  showLineNumbers={true}
                  wordWrap={true}
                />
              </div>

              {/* Validation status bar */}
              {editorState.isValidating && (
                <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900 border-t border-blue-200 dark:border-blue-700 text-xs text-blue-700 dark:text-blue-200">
                  Validating...
                </div>
              )}

              {editorState.validation && !editorState.validation.valid && (
                <div className="px-4 py-3 bg-red-50 dark:bg-red-900 border-t border-red-200 dark:border-red-700">
                  <p className="text-xs font-medium text-red-700 dark:text-red-200">
                    Validation Error
                    {editorState.validation.line && ` (Line ${editorState.validation.line})`}
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-1 font-mono">
                    {editorState.validation.error}
                  </p>
                </div>
              )}

              {editorState.validation?.valid && editorContent?.trim() && (
                <div className="px-4 py-2 bg-green-50 dark:bg-green-900 border-t border-green-200 dark:border-green-700 text-xs text-green-700 dark:text-green-200">
                  Valid diagram syntax
                </div>
              )}
            </div>
          }
          secondaryContent={
            <div className="flex flex-col h-full p-4 bg-gray-50 dark:bg-gray-800 overflow-auto">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                Preview
              </h2>
              <div className="flex-1">
                <MermaidPreview
                  content={editorContent}
                  onError={(error) => {
                    setEditorState((prev) => ({
                      ...prev,
                      error: `Preview error: ${error.message}`,
                    }));
                  }}
                />
              </div>
            </div>
          }
        />
      </div>

      {/* Keyboard hints footer */}
      <div className="px-6 py-2 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-mono">Cmd+S</span>
        {' '}or{' '}
        <span className="font-mono">Ctrl+S</span>
        {' '}to save •{' '}
        <span className="font-mono">Esc</span>
        {' '}to exit
      </div>
    </div>
  );
};

export default DiagramEditor;
