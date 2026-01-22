/**
 * useDocument Hook
 *
 * Provides React integration for document operations with:
 * - Access to documents in current session
 * - Document selection management
 * - Document CRUD operations
 * - Selected document convenience getter
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Document } from '../types';
import { useSessionStore } from '../stores/sessionStore';

export interface UseDocumentReturn {
  // Document state
  documents: Document[];
  selectedDocumentId: string | null;
  selectedDocument: Document | undefined;

  // Document operations
  addDocument: (document: Document) => void;
  updateDocument: (id: string, updates: Partial<Document>) => void;
  removeDocument: (id: string) => void;
  selectDocument: (id: string | null) => void;

  // Bulk operations
  setDocuments: (documents: Document[]) => void;

  // Utility
  getDocumentById: (id: string) => Document | undefined;
  hasDocument: (id: string) => boolean;
}

/**
 * Hook for accessing and managing documents in the current session
 *
 * Provides convenient access to document state and operations from the session store
 *
 * @returns Document state and operation methods
 *
 * @example
 * ```tsx
 * function DocumentList() {
 *   const { documents, selectedDocument, selectDocument, removeDocument } = useDocument();
 *
 *   return (
 *     <div>
 *       {documents.map((d) => (
 *         <div
 *           key={d.id}
 *           onClick={() => selectDocument(d.id)}
 *           style={{
 *             fontWeight: selectedDocument?.id === d.id ? 'bold' : 'normal',
 *           }}
 *         >
 *           <span>{d.name}</span>
 *           <button onClick={(e) => {
 *             e.stopPropagation();
 *             removeDocument(d.id);
 *           }}>
 *             Delete
 *           </button>
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDocument(): UseDocumentReturn {
  // Get document state using shallow comparison
  const {
    documents,
    selectedDocumentId,
    getSelectedDocument,
    setDocuments,
    addDocument,
    updateDocument,
    removeDocument,
    selectDocument,
  } = useSessionStore(
    useShallow((state) => ({
      documents: state.documents,
      selectedDocumentId: state.selectedDocumentId,
      getSelectedDocument: state.getSelectedDocument,
      setDocuments: state.setDocuments,
      addDocument: state.addDocument,
      updateDocument: state.updateDocument,
      removeDocument: state.removeDocument,
      selectDocument: state.selectDocument,
    }))
  );

  // Get selected document
  const selectedDocument = getSelectedDocument();

  // Get document by ID
  const getDocumentById = useCallback(
    (id: string): Document | undefined => {
      return documents.find((d) => d.id === id);
    },
    [documents]
  );

  // Check if document exists
  const hasDocument = useCallback(
    (id: string): boolean => {
      return documents.some((d) => d.id === id);
    },
    [documents]
  );

  return {
    documents,
    selectedDocumentId,
    selectedDocument,
    addDocument: useCallback(
      (document: Document) => {
        addDocument(document);
      },
      [addDocument]
    ),
    updateDocument: useCallback(
      (id: string, updates: Partial<Document>) => {
        updateDocument(id, updates);
      },
      [updateDocument]
    ),
    removeDocument: useCallback(
      (id: string) => {
        removeDocument(id);
      },
      [removeDocument]
    ),
    selectDocument: useCallback(
      (id: string | null) => {
        selectDocument(id);
      },
      [selectDocument]
    ),
    setDocuments: useCallback(
      (documents: Document[]) => {
        setDocuments(documents);
      },
      [setDocuments]
    ),
    getDocumentById,
    hasDocument,
  };
}
