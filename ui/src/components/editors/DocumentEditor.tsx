/**
 * DocumentEditor Component
 *
 * Full document editor with split pane layout:
 * - Left side: CodeMirrorWrapper for editing markdown
 * - Right side: MarkdownPreview for live preview
 * - Responsive design with persistent split position
 * - Document saving and change tracking
 * - Keyboard shortcuts (Ctrl+S to save)
 * - Loading and error states
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SplitPane } from '@/components/layout/SplitPane';
import { CodeMirrorWrapper } from './CodeMirrorWrapper';
import { MarkdownPreview } from './MarkdownPreview';
import { useDocument } from '@/hooks/useDocument';
import { Document } from '@/types';

/**
 * Props for the DocumentEditor component
 */
export interface DocumentEditorProps {
  /** Document ID to edit (uses selectedDocument if not provided) */
  documentId?: string;
  /** Callback when document is saved */
  onSave?: (document: Document) => void;
  /** Callback when document changes */
  onChange?: (content: string) => void;
  /** Whether to show action buttons */
  showButtons?: boolean;
  /** Custom CSS class name for the container */
  className?: string;
  /** Debounce delay for preview updates (milliseconds) */
  debounceDelay?: number;
}

/**
 * DocumentEditor Component
 *
 * Provides a full-featured markdown document editor with:
 * - Split pane layout (editor left, preview right)
 * - Debounced preview updates for performance
 * - Document save/cancel functionality
 * - Keyboard shortcuts (Ctrl+S to save)
 * - Loading and error states
 * - Responsive design
 *
 * @example
 * ```tsx
 * function Editor() {
 *   const handleSave = (doc) => {
 *     console.log('Saved:', doc);
 *   };
 *
 *   return (
 *     <DocumentEditor
 *       onSave={handleSave}
 *       showButtons={true}
 *     />
 *   );
 * }
 * ```
 */
export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  documentId,
  onSave,
  onChange,
  showButtons = true,
  className = '',
  debounceDelay = 300,
}) => {
  const { selectedDocument, updateDocument } = useDocument();

  // Determine which document to use
  const document = documentId
    ? useDocument().getDocumentById(documentId)
    : selectedDocument;

  // Local state for editor
  const [content, setContent] = useState<string>(document?.content ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Debounce timer ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Update local content when document changes
  useEffect(() => {
    if (document) {
      setContent(document.content);
      setHasChanges(false);
      setError(null);
    }
  }, [document?.id, document?.content]);

  // Handle content changes with debouncing for preview
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      setHasChanges(true);
      setError(null);

      // Call onChange callback immediately for preview updates
      onChange?.(newContent);

      // Debounce update to store (for undo/redo considerations)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        if (document) {
          updateDocument(document.id, {
            content: newContent,
            lastModified: Date.now(),
          });
        }
      }, debounceDelay);
    },
    [document, onChange, updateDocument, debounceDelay]
  );

  // Handle save
  const handleSave = useCallback(async () => {
    if (!document) {
      setError('No document selected');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      // Update document with current content
      const updatedDocument: Document = {
        ...document,
        content,
        lastModified: Date.now(),
      };

      updateDocument(document.id, {
        content,
        lastModified: Date.now(),
      });

      setHasChanges(false);
      onSave?.(updatedDocument);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save document';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }, [document, content, updateDocument, onSave]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (document) {
      setContent(document.content);
      setHasChanges(false);
      setError(null);
    }
  }, [document]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }

      // Escape to cancel if there are changes
      if (e.key === 'Escape' && hasChanges) {
        handleCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleCancel, hasChanges]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 ${className}`}
        data-testid="document-editor-loading"
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500 mx-auto mb-3" />
          <p className="text-gray-600 dark:text-gray-400">Loading document...</p>
        </div>
      </div>
    );
  }

  // No document selected
  if (!document) {
    return (
      <div
        className={`flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 ${className}`}
        data-testid="document-editor-empty"
      >
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-2">No document selected</p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Select or create a document to start editing
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full bg-white dark:bg-gray-900 ${className}`}
      data-testid="document-editor"
    >
      {/* Error message */}
      {error && (
        <div
          className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-2 rounded-t-lg"
          data-testid="document-editor-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Editor header with document name and buttons */}
      {showButtons && (
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
          data-testid="document-editor-header"
        >
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {document.name}
            </h2>
            {hasChanges && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Unsaved changes
              </p>
            )}
          </div>

          <div className="flex gap-2 ml-4">
            <button
              onClick={handleCancel}
              disabled={!hasChanges || isSaving}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              data-testid="document-editor-cancel-btn"
              title="Escape key"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="px-3 py-1.5 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              data-testid="document-editor-save-btn"
              title="Ctrl+S or Cmd+S"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Split pane with editor and preview */}
      <div className="flex-1 min-h-0" data-testid="document-editor-content">
        <SplitPane
          primaryContent={
            <div className="flex flex-col h-full">
              <div className="flex-1 min-h-0 border-r border-gray-200 dark:border-gray-700">
                <CodeMirrorWrapper
                  value={content}
                  onChange={handleContentChange}
                  language="markdown"
                  height="100%"
                  placeholder="Enter markdown content..."
                  data-testid="document-editor-codemirror"
                />
              </div>
            </div>
          }
          secondaryContent={
            <div className="flex flex-col h-full overflow-auto">
              <MarkdownPreview
                content={content}
                className="flex-1"
                data-testid="document-editor-preview"
              />
            </div>
          }
          direction="horizontal"
          defaultPrimarySize={50}
          minPrimarySize={20}
          maxPrimarySize={80}
          minSecondarySize={20}
          storageId="document-editor-split"
        />
      </div>

      {/* Footer with keyboard hints */}
      {showButtons && (
        <div
          className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400"
          data-testid="document-editor-footer"
        >
          <span>Press Ctrl+S or Cmd+S to save</span>
          {hasChanges && <span className="ml-4">Escape to cancel</span>}
        </div>
      )}
    </div>
  );
};

export default DocumentEditor;
