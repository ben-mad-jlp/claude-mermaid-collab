/**
 * DocumentEditor.wysiwyg
 *
 * WYSIWYG variant of DocumentEditor backed by Milkdown.
 * Preserves the public contract of the legacy component (props, save/cancel,
 * onChange/onSave) but removes CodeMirror/preview/minimap/sync-scroll/annotation
 * specific behavior. This is the Phase 0 stub for migrating off CodeMirror.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView } from '@milkdown/prose/view';
import { MilkdownEditor, type MilkdownEditorHandle } from './milkdown/MilkdownEditor';
import { useDocument } from '@/hooks/useDocument';
import { Document } from '@/types';
import { HistoryModal } from './HistoryModal';
import { MarkdownPreview } from './MarkdownPreview';
import {
  CollapsibleSectionsProvider,
  CollapsibleSectionsControls,
} from './CollapsibleSection';
import type { DocumentEditorProps } from './DocumentEditor.legacy';
import type { Annotation } from './milkdown/plugins/annotations/schema';
import { AnnotationToolbarWysiwyg } from './milkdown/plugins/annotations/toolbar';
import {
  hasLegacyAnnotations,
  migrateInlineAnnotations,
} from './milkdown/plugins/annotations/migrator';

export const DocumentEditorWysiwyg: React.FC<DocumentEditorProps> = ({
  documentId,
  onSave,
  onChange,
  showButtons = true,
  className = '',
  diff,
}) => {
  const { selectedDocument, updateDocument, getDocumentById } = useDocument();

  // Resolve target document
  const document = documentId ? getDocumentById(documentId) : selectedDocument;

  // Editor state
  const [content, setContent] = useState<string>(document?.content ?? '');
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Annotations — sourced from document.metadata, migrated from legacy
  // inline HTML-comment markers on first load.
  const [annotations, setAnnotations] = useState<Annotation[]>(
    () => ((document as unknown as { metadata?: { annotations?: Annotation[] } })?.metadata?.annotations) ?? [],
  );

  // History modal state
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedHistoryTimestamp, setSelectedHistoryTimestamp] = useState('');
  const [selectedHistoryContent, setSelectedHistoryContent] = useState('');

  // Flush ref exposed to MilkdownEditor so we can force-sync before save
  const flushRef = useRef<(() => void) | null>(null);

  // Imperative handle to milkdown for setMarkdown (used on Cancel)
  const milkdownHandleRef = useRef<MilkdownEditorHandle | null>(null);

  // Editor view in state so the toolbar re-renders once Milkdown is ready.
  // Refs don't trigger re-renders, so reading getView() during render of the
  // toolbar would silently be null on first paint.
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const handleEditorReady = useCallback((view: EditorView) => {
    setEditorView(view);
  }, []);

  // Tracks the latest markdown from onChange so handleSave doesn't read
  // stale React state (content is set via setState which is async/batched).
  const latestMarkdownRef = useRef<string>(document?.content ?? '');

  // Reset local state when the target document changes. Intentionally keyed
  // on document?.id only — watching document.content would clobber mid-typing
  // edits when the server echoes back a save.
  useEffect(() => {
    if (document) {
      // One-shot migration: if the content contains legacy annotation
      // markers, strip them and seed the annotation list. The anchor text-
      // scan fallback in resolveAnchor will locate each range.
      if (document.content && hasLegacyAnnotations(document.content)) {
        const { cleanedMarkdown, annotations: migrated } = migrateInlineAnnotations(
          document.content,
        );
        setContent(cleanedMarkdown);
        latestMarkdownRef.current = cleanedMarkdown;
        setAnnotations(migrated);
        setHasChanges(true); // user needs to save to persist the cleanup
        setError(null);
        return;
      }
      setContent(document.content);
      latestMarkdownRef.current = document.content;
      const existing =
        ((document as unknown as { metadata?: { annotations?: Annotation[] } })?.metadata
          ?.annotations) ?? [];
      setAnnotations(existing);
      setHasChanges(false);
      setError(null);
    }
  }, [document?.id]);

  const handleContentChange = useCallback(
    (md: string) => {
      latestMarkdownRef.current = md;
      setContent(md);
      setHasChanges(true);
      setError(null);
      onChange?.(md);
    },
    [onChange]
  );

  const handlePersist = useCallback(
    (md: string) => {
      if (!document) return;
      try {
        updateDocument(document.id, {
          content: md,
          lastModified: Date.now(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to persist document';
        setError(message);
      }
    },
    [document, updateDocument]
  );

  // Best-effort stash of annotations for future server-side persistence.
  // updateDocument currently only accepts (content, lastModified); we park the
  // annotations on a window global so a follow-up task can wire them through.
  const stashPendingAnnotations = useCallback(
    (docId: string, next: Annotation[]) => {
      try {
        const w = window as unknown as { __pendingAnnotations?: Record<string, Annotation[]> };
        w.__pendingAnnotations = w.__pendingAnnotations ?? {};
        w.__pendingAnnotations[docId] = next;
      } catch {
        // swallow — not critical
      }
    },
    [],
  );

  const handleAnnotationsChange = useCallback(
    (next: Annotation[]) => {
      setAnnotations(next);
      setHasChanges(true);
      if (document) stashPendingAnnotations(document.id, next);
    },
    [document, stashPendingAnnotations],
  );

  const handleSave = useCallback(async () => {
    if (!document) {
      setError('No document selected');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      // Force milkdown to flush any pending markdown through onChange so
      // latestMarkdownRef is up-to-date before we persist.
      flushRef.current?.();

      // Prefer the ref (sync, updated on every keystroke) over the `content`
      // state (batched/async — may be stale inside this callback).
      const finalContent = latestMarkdownRef.current ?? content;

      await Promise.resolve(
        updateDocument(document.id, {
          content: finalContent,
          lastModified: Date.now(),
        })
      );

      const updatedDocument: Document = {
        ...document,
        content: finalContent,
        lastModified: Date.now(),
      };

      // Re-sync React state to the persisted value so any downstream
      // consumers (HistoryModal's currentContent, etc.) see the saved text.
      setContent(finalContent);
      setHasChanges(false);
      onSave?.(updatedDocument);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save document';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }, [document, content, updateDocument, onSave]);

  const handleCancel = useCallback(() => {
    if (document) {
      // Revert the ProseMirror doc in Milkdown so the editor UI actually
      // shows the original content (not just our React state).
      milkdownHandleRef.current?.setMarkdown(document.content);
      setContent(document.content);
      latestMarkdownRef.current = document.content;
      setHasChanges(false);
      setError(null);
    }
  }, [document]);

  const handleHistoryModalClose = useCallback(() => {
    setHistoryModalOpen(false);
  }, []);

  const openHistoryModal = useCallback(() => {
    setSelectedHistoryTimestamp('');
    setSelectedHistoryContent('');
    setHistoryModalOpen(true);
  }, []);

  // Keyboard shortcuts: Ctrl/Cmd+S saves. Escape is intentionally a no-op in
  // the WYSIWYG variant (legacy cancelled on Escape, but that conflicts with
  // Milkdown's own editing interactions — see migration notes).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Escape: no-op (explicit)
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (diff) {
    return (
      <div
        className={`flex flex-col h-full bg-white dark:bg-gray-900 ${className ?? ''}`}
        data-testid="document-editor-wysiwyg-diff"
      >
        <MarkdownPreview
          content={diff.newContent}
          diff={diff}
          className="flex-1"
        />
      </div>
    );
  }

  // Empty state
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
    <CollapsibleSectionsProvider>
    <div
      className={`flex flex-col h-full bg-white dark:bg-gray-900 ${className}`}
      data-testid="document-editor-wysiwyg"
    >
      {error && (
        <div
          className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-2 rounded-t-lg"
          data-testid="document-editor-error"
          role="alert"
        >
          {error}
        </div>
      )}

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
              <p className="text-sm text-gray-500 dark:text-gray-400">Unsaved changes</p>
            )}
          </div>

          <div className="flex gap-2 ml-4">
            <button
              onClick={openHistoryModal}
              disabled={isSaving}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              data-testid="document-editor-history-btn"
              aria-label="View document history"
              title="View version history"
            >
              History
            </button>
            <button
              onClick={handleCancel}
              disabled={!hasChanges || isSaving}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              data-testid="document-editor-cancel-btn"
              title="Revert changes"
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

      <AnnotationToolbarWysiwyg
        editorView={editorView}
        annotations={annotations}
        onAnnotationsChange={handleAnnotationsChange}
      />

      <div className="px-4 pt-2">
        <CollapsibleSectionsControls />
      </div>

      <div className="flex-1 min-h-0 overflow-auto" data-testid="document-editor-content">
        <MilkdownEditor
          ref={milkdownHandleRef}
          docId={document.id}
          initialMarkdown={document.content}
          onChange={handleContentChange}
          onPersist={handlePersist}
          onFlushRef={flushRef}
          annotations={annotations}
          onAnnotationsChange={handleAnnotationsChange}
          onReady={handleEditorReady}
        />
      </div>

      <HistoryModal
        isOpen={historyModalOpen}
        onClose={handleHistoryModalClose}
        historicalContent={selectedHistoryContent}
        currentContent={content}
        timestamp={selectedHistoryTimestamp}
        documentName={document?.name}
      />
    </div>
    </CollapsibleSectionsProvider>
  );
};

export default DocumentEditorWysiwyg;
