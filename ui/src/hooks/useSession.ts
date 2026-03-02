/**
 * useSession Hook
 *
 * Provides React integration for session state management with:
 * - Access to current session state
 * - Loading and error state tracking
 * - Session selection and clearing
 * - Convenient selectors for diagrams and documents
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Session, Diagram, Document, CollabState } from '../types';
import { useSessionStore, Design } from '../stores/sessionStore';

export interface UseSessionReturn {
  // Session state
  currentSession: Session | null;
  isLoading: boolean;
  error: string | null;

  // Diagram state
  diagrams: Diagram[];
  selectedDiagramId: string | null;
  selectedDiagram: Diagram | undefined;

  // Document state
  documents: Document[];
  selectedDocumentId: string | null;
  selectedDocument: Document | undefined;

  // Design state
  designs: Design[];
  selectedDesignId: string | null;
  selectedDesign: Design | undefined;

  // Collab state
  collabState: CollabState | null;

  // Session actions
  setCurrentSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Diagram actions
  addDiagram: (diagram: Diagram) => void;
  updateDiagram: (id: string, updates: Partial<Diagram>) => void;
  removeDiagram: (id: string) => void;
  selectDiagram: (id: string | null) => void;

  // Document actions
  addDocument: (document: Document) => void;
  updateDocument: (id: string, updates: Partial<Document>) => void;
  removeDocument: (id: string) => void;
  selectDocument: (id: string | null) => void;

  // Design actions
  addDesign: (design: Design) => void;
  updateDesign: (id: string, updates: Partial<Design>) => void;
  removeDesign: (id: string) => void;
  selectDesign: (id: string | null) => void;

  // Collab state actions
  setCollabState: (state: CollabState | null) => void;

  // Utility actions
  clearSession: () => void;
  reset: () => void;
}

/**
 * Hook for accessing session state and managing session data
 *
 * Provides convenient access to the session store with automatic
 * selector optimization to prevent unnecessary re-renders
 *
 * @returns Session state and action methods
 *
 * @example
 * ```tsx
 * function SessionComponent() {
 *   const { currentSession, isLoading, error, diagrams, selectDiagram } = useSession();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error}</div>;
 *   if (!currentSession) return <div>No session selected</div>;
 *
 *   return (
 *     <div>
 *       <h1>{currentSession.name}</h1>
 *       <div>
 *         {diagrams.map((d) => (
 *           <button key={d.id} onClick={() => selectDiagram(d.id)}>
 *             {d.name}
 *           </button>
 *         ))}
 *       </div>
 *     </div>
 *   );
 * }
 * ```
 */
export function useSession(): UseSessionReturn {
  // Get state using shallow comparison to prevent unnecessary re-renders
  const {
    currentSession,
    isLoading,
    error,
    diagrams,
    selectedDiagramId,
    documents,
    selectedDocumentId,
    designs,
    selectedDesignId,
    collabState,
    setCurrentSession,
    setLoading,
    setError,
    addDiagram,
    updateDiagram,
    removeDiagram,
    selectDiagram,
    getSelectedDiagram,
    addDocument,
    updateDocument,
    removeDocument,
    selectDocument,
    getSelectedDocument,
    addDesign,
    updateDesign,
    removeDesign,
    selectDesign,
    getSelectedDesign,
    setCollabState,
    clearSession,
    reset,
  } = useSessionStore(
    useShallow((state) => ({
      currentSession: state.currentSession,
      isLoading: state.isLoading,
      error: state.error,
      diagrams: state.diagrams,
      selectedDiagramId: state.selectedDiagramId,
      documents: state.documents,
      selectedDocumentId: state.selectedDocumentId,
      designs: state.designs,
      selectedDesignId: state.selectedDesignId,
      collabState: state.collabState,
      setCurrentSession: state.setCurrentSession,
      setLoading: state.setLoading,
      setError: state.setError,
      addDiagram: state.addDiagram,
      updateDiagram: state.updateDiagram,
      removeDiagram: state.removeDiagram,
      selectDiagram: state.selectDiagram,
      getSelectedDiagram: state.getSelectedDiagram,
      addDocument: state.addDocument,
      updateDocument: state.updateDocument,
      removeDocument: state.removeDocument,
      selectDocument: state.selectDocument,
      getSelectedDocument: state.getSelectedDocument,
      addDesign: state.addDesign,
      updateDesign: state.updateDesign,
      removeDesign: state.removeDesign,
      selectDesign: state.selectDesign,
      getSelectedDesign: state.getSelectedDesign,
      setCollabState: state.setCollabState,
      clearSession: state.clearSession,
      reset: state.reset,
    }))
  );

  // Memoize selected diagram getter
  const selectedDiagram = useCallback(() => {
    return getSelectedDiagram();
  }, [getSelectedDiagram])();

  // Memoize selected document getter
  const selectedDocument = useCallback(() => {
    return getSelectedDocument();
  }, [getSelectedDocument])();

  // Memoize selected design getter
  const selectedDesign = useCallback(() => {
    return getSelectedDesign();
  }, [getSelectedDesign])();

  return {
    currentSession,
    isLoading,
    error,
    diagrams,
    selectedDiagramId,
    selectedDiagram,
    documents,
    selectedDocumentId,
    selectedDocument,
    designs,
    selectedDesignId,
    selectedDesign,
    collabState,
    setCurrentSession,
    setLoading,
    setError,
    addDiagram,
    updateDiagram,
    removeDiagram,
    selectDiagram,
    addDocument,
    updateDocument,
    removeDocument,
    selectDocument,
    addDesign,
    updateDesign,
    removeDesign,
    selectDesign,
    setCollabState,
    clearSession,
    reset,
  };
}
