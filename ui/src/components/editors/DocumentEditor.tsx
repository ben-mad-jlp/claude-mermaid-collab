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
 * - Annotation toolbar for collaborative editing
 * - Minimap for document navigation
 * - Synchronized scrolling between editor and preview
 * - Diff view for comparing changes
 * - Export clean markdown without annotation markers
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SplitPane } from '@/components/layout/SplitPane';
import { CodeMirrorWrapper } from './CodeMirrorWrapper';
import { MarkdownPreview } from './MarkdownPreview';
import { useDocument } from '@/hooks/useDocument';
import { Document } from '@/types';
import { AnnotationToolbar } from './AnnotationToolbar';
import { Minimap } from './Minimap';
import { useSyncScroll } from '@/hooks/useSyncScroll';
import { downloadCleanMarkdown } from '@/lib/annotationUtils';
import { EditorView } from '@codemirror/view';
import { HistoryDropdown } from './HistoryDropdown';
import { HistoryModal } from './HistoryModal';

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
  /** Whether to show minimap (default: true) */
  showMinimap?: boolean;
  /** Whether sync scroll is enabled by default (default: true) */
  defaultSyncScroll?: boolean;
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
  showMinimap = true,
  defaultSyncScroll = true,
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

  // New state for annotation features
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [previousContent, setPreviousContent] = useState<string>('');

  // History modal state
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedHistoryTimestamp, setSelectedHistoryTimestamp] = useState('');
  const [selectedHistoryContent, setSelectedHistoryContent] = useState('');

  // Refs for scroll synchronization
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  // Scroll position tracking for minimap
  const [scrollPosition, setScrollPosition] = useState(0);
  const [viewportFraction, setViewportFraction] = useState(0.2);

  // Use sync scroll hook
  const { isSynced, toggleSync } = useSyncScroll({
    editorRef: editorScrollRef,
    previewRef: previewScrollRef,
    enabled: defaultSyncScroll,
  });

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

  // Handle editor ready callback
  const handleEditorReady = useCallback((view: EditorView | null) => {
    setEditorView(view);
  }, []);

  // Handle export clean markdown
  const handleExportClean = useCallback(() => {
    if (document) {
      downloadCleanMarkdown(document.name, content);
    }
  }, [document, content]);

  // Handle diff toggle
  const handleToggleDiff = useCallback(() => {
    if (!showDiff) {
      setPreviousContent(document?.content || '');
    }
    setShowDiff(!showDiff);
  }, [showDiff, document?.content]);

  // Handle clear diff
  const handleClearDiff = useCallback(() => {
    setShowDiff(false);
    setPreviousContent('');
  }, []);

  // Handle history version selection
  const handleHistoryVersionSelect = useCallback((timestamp: string, content: string) => {
    setSelectedHistoryTimestamp(timestamp);
    setSelectedHistoryContent(content);
    setHistoryModalOpen(true);
  }, []);

  // Handle history modal close
  const handleHistoryModalClose = useCallback(() => {
    setHistoryModalOpen(false);
  }, []);

  // Handle minimap scroll navigation
  const handleMinimapScrollTo = useCallback((position: number) => {
    if (editorScrollRef.current) {
      const scrollHeight = editorScrollRef.current.scrollHeight - editorScrollRef.current.clientHeight;
      editorScrollRef.current.scrollTop = position * scrollHeight;
    }
  }, []);

  // Handle click-to-source from preview
  const handleSourceLineClick = useCallback((line: number) => {
    if (editorView) {
      try {
        // Scroll to line in editor
        const lineInfo = editorView.state.doc.line(line);
        editorView.dispatch({
          selection: { anchor: lineInfo.from },
          scrollIntoView: true,
        });
      } catch {
        // Line number out of range, ignore
      }
    }
  }, [editorView]);

  // Track scroll position for minimap
  useEffect(() => {
    const editorElement = editorScrollRef.current;
    if (!editorElement) return;

    const handleScroll = () => {
      const scrollableHeight = editorElement.scrollHeight - editorElement.clientHeight;
      const newPosition = scrollableHeight > 0 ? editorElement.scrollTop / scrollableHeight : 0;
      const newViewportFraction = editorElement.clientHeight / editorElement.scrollHeight;
      setScrollPosition(newPosition);
      setViewportFraction(newViewportFraction);
    };

    // Initial calculation
    handleScroll();

    editorElement.addEventListener('scroll', handleScroll);
    return () => editorElement.removeEventListener('scroll', handleScroll);
  }, []);

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

      {/* Editor header with document name, annotation toolbar, and buttons */}
      {showButtons && (
        <div
          className="flex flex-col border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
          data-testid="document-editor-header"
        >
          {/* Primary header row */}
          <div className="flex items-center justify-between px-4 py-3">
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

          {/* Secondary toolbar row with annotation tools and feature toggles */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-700">
            {/* Annotation toolbar */}
            <AnnotationToolbar editorView={editorView} />

            {/* Feature toggle buttons */}
            <div className="flex gap-2 items-center">
              <button
                onClick={toggleSync}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  isSynced
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}
                data-testid="document-editor-sync-btn"
                title="Toggle synchronized scrolling"
              >
                {isSynced ? 'Sync On' : 'Sync Off'}
              </button>
              <button
                onClick={handleToggleDiff}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  showDiff
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}
                data-testid="document-editor-diff-btn"
                title="Toggle diff view"
              >
                Diff
              </button>
              <button
                onClick={handleExportClean}
                className="px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                data-testid="document-editor-export-btn"
                title="Export clean markdown without annotations"
              >
                Export Clean
              </button>
              {document && (
                <HistoryDropdown
                  documentId={document.id}
                  currentContent={content}
                  onVersionSelect={handleHistoryVersionSelect}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Split pane with editor and preview */}
      <div className="flex-1 min-h-0" data-testid="document-editor-content">
        <SplitPane
          primaryContent={
            <div className="flex flex-col h-full">
              <div
                ref={editorScrollRef}
                className="flex-1 min-h-0 border-r border-gray-200 dark:border-gray-700 overflow-auto"
              >
                <CodeMirrorWrapper
                  value={content}
                  onChange={handleContentChange}
                  onEditorReady={handleEditorReady}
                  language="markdown"
                  height="100%"
                  placeholder="Enter markdown content..."
                />
              </div>
            </div>
          }
          secondaryContent={
            <div className="flex h-full">
              {/* Preview pane */}
              <div className="flex flex-col flex-1 min-w-0">
                <MarkdownPreview
                  content={content}
                  className="flex-1"
                  diff={showDiff ? { oldContent: previousContent, newContent: content } : null}
                  onClearDiff={handleClearDiff}
                  onElementClick={handleSourceLineClick}
                  scrollRef={previewScrollRef}
                />
              </div>

              {/* Minimap */}
              {showMinimap && (
                <Minimap
                  content={content}
                  lineCount={content.split('\n').length}
                  scrollPosition={scrollPosition}
                  viewportFraction={viewportFraction}
                  onScrollTo={handleMinimapScrollTo}
                  className="flex-shrink-0 h-full"
                />
              )}
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

      {/* History Modal */}
      <HistoryModal
        isOpen={historyModalOpen}
        onClose={handleHistoryModalClose}
        historicalContent={selectedHistoryContent}
        currentContent={content}
        timestamp={selectedHistoryTimestamp}
        documentName={document?.name}
      />
    </div>
  );
};

export default DocumentEditor;
