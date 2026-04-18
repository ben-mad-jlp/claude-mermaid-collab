import React, { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MilkdownEditor, type MilkdownEditorHandle } from './milkdown/MilkdownEditor';
import { CollapsibleSectionsProvider } from './CollapsibleSection';
import { useUIStore } from '@/stores/uiStore';
import type { Document } from '@/types';

export interface DocumentViewProps {
  document: Document;
  onContentChange?: (content: string) => void;
}

export const DocumentView: React.FC<DocumentViewProps> = ({ document, onContentChange }) => {
  const { documentEditable, toggleDocumentEditable } = useUIStore(
    useShallow((state) => ({
      documentEditable: state.documentEditable,
      toggleDocumentEditable: state.toggleDocumentEditable,
    })),
  );

  const milkdownRef = useRef<MilkdownEditorHandle | null>(null);
  const flushRef = useRef<(() => void) | null>(null);

  const handleChange = useCallback(
    (md: string) => {
      onContentChange?.(md);
    },
    [onContentChange],
  );

  const handlePersist = useCallback(
    (md: string) => {
      onContentChange?.(md);
    },
    [onContentChange],
  );

  // When switching back to review mode, flush pending edits so the last
  // keystroke makes it to the persistence layer before the editor goes read-only.
  useEffect(() => {
    if (!documentEditable) flushRef.current?.();
  }, [documentEditable]);

  return (
    <CollapsibleSectionsProvider>
    <div className="relative h-full bg-white dark:bg-gray-900">
      <button
        type="button"
        data-testid="document-edit-toggle"
        onClick={toggleDocumentEditable}
        aria-label={documentEditable ? 'Lock document (review mode)' : 'Edit document'}
        aria-pressed={documentEditable}
        title={documentEditable ? 'Reviewing — click to lock' : 'Click to edit'}
        className={`absolute top-2 right-6 z-10 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors shadow-sm ${
          documentEditable
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            : 'bg-white/90 dark:bg-gray-800/90 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
        }`}
      >
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
        </svg>
        <span>{documentEditable ? 'Editing' : 'Edit'}</span>
      </button>
      <div className="h-full overflow-auto px-4 py-4">
        {document.content == null ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            Loading…
          </div>
        ) : (
          <MilkdownEditor
            key={document.id}
            ref={milkdownRef}
            docId={document.id}
            initialMarkdown={document.content}
            onChange={handleChange}
            onPersist={handlePersist}
            onFlushRef={flushRef}
            editable={documentEditable}
          />
        )}
      </div>
    </div>
    </CollapsibleSectionsProvider>
  );
};

export default DocumentView;
