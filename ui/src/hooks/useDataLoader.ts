/**
 * useDataLoader Hook
 *
 * Provides async functions to load sessions and session items (diagrams/documents)
 * from the API and populate the session store.
 *
 * Features:
 * - Load all available sessions
 * - Load diagrams and documents for a specific session
 * - Track loading and error states
 */

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/sessionStore';

export interface UseDataLoaderReturn {
  /** Whether a data loading operation is in progress */
  isLoading: boolean;
  /** Error message if the last operation failed */
  error: string | null;
  /** Load all available sessions from the API */
  loadSessions: () => Promise<void>;
  /** Load diagrams, documents, and wireframes for a specific session */
  loadSessionItems: (project: string, session: string) => Promise<void>;
  /** Refresh session items while preserving current selection */
  refreshSessionItems: (project: string, session: string) => Promise<void>;
  /** Select a diagram and fetch its content */
  selectDiagramWithContent: (project: string, session: string, id: string) => Promise<void>;
  /** Select a document and fetch its content */
  selectDocumentWithContent: (project: string, session: string, id: string) => Promise<void>;
  /** Select a wireframe and fetch its content */
  selectWireframeWithContent: (project: string, session: string, id: string) => Promise<void>;
}

/**
 * Hook to load sessions and session items from the API
 *
 * @returns Object with loading state, error state, and load functions
 *
 * @example
 * ```tsx
 * function SessionLoader() {
 *   const { isLoading, error, loadSessions, loadSessionItems } = useDataLoader();
 *
 *   useEffect(() => {
 *     loadSessions();
 *   }, [loadSessions]);
 *
 *   const handleSessionSelect = (session) => {
 *     loadSessionItems(session.project, session.name);
 *   };
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error}</div>;
 *
 *   return <div>Sessions loaded!</div>;
 * }
 * ```
 */
export function useDataLoader(): UseDataLoaderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get store setters
  const setSessions = useSessionStore((state) => state.setSessions);
  const setDiagrams = useSessionStore((state) => state.setDiagrams);
  const setDocuments = useSessionStore((state) => state.setDocuments);
  const setWireframes = useSessionStore((state) => state.setWireframes);
  const selectDiagram = useSessionStore((state) => state.selectDiagram);
  const selectDocument = useSessionStore((state) => state.selectDocument);
  const selectWireframe = useSessionStore((state) => state.selectWireframe);
  const updateDiagram = useSessionStore((state) => state.updateDiagram);
  const updateDocument = useSessionStore((state) => state.updateDocument);
  const updateWireframe = useSessionStore((state) => state.updateWireframe);
  const setCollabState = useSessionStore((state) => state.setCollabState);

  /**
   * Load all available sessions from the API
   */
  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const sessions = await api.getSessions();
      setSessions(sessions);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load sessions';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [setSessions]);

  /**
   * Load collab session state
   */
  const loadCollabState = useCallback(
    async (project: string, session: string) => {
      try {
        const state = await api.getSessionState(project, session);
        setCollabState(state);
      } catch (err) {
        console.error('Failed to load collab state:', err);
        setCollabState(null);
      }
    },
    [setCollabState]
  );

  /**
   * Load diagrams, documents, and wireframes for a specific session
   */
  const loadSessionItems = useCallback(
    async (project: string, session: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const diagrams = await api.getDiagrams(project, session);
        const documents = await api.getDocuments(project, session);
        const wireframes = await api.getWireframes(project, session);
        setDiagrams(diagrams);
        setDocuments(documents);
        setWireframes(wireframes);

        // Also load collab state
        await loadCollabState(project, session);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load session items';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [setDiagrams, setDocuments, setWireframes, loadCollabState]
  );

  /**
   * Refresh session items while preserving current selection
   */
  const refreshSessionItems = useCallback(
    async (project: string, session: string) => {
      // Capture current selection
      const { selectedDiagramId, selectedDocumentId, selectedWireframeId } = useSessionStore.getState();

      // Load fresh data
      await loadSessionItems(project, session);

      // Restore selection if items still exist
      const { diagrams: newDiagrams, documents: newDocuments, wireframes: newWireframes } = useSessionStore.getState();

      if (selectedDiagramId && newDiagrams.find((d) => d.id === selectedDiagramId)) {
        selectDiagram(selectedDiagramId);
      } else if (selectedDocumentId && newDocuments.find((d) => d.id === selectedDocumentId)) {
        selectDocument(selectedDocumentId);
      } else if (selectedWireframeId && newWireframes.find((w) => w.id === selectedWireframeId)) {
        selectWireframe(selectedWireframeId);
      }
    },
    [loadSessionItems, selectDiagram, selectDocument, selectWireframe]
  );

  /**
   * Select a diagram and fetch its full content
   */
  const selectDiagramWithContent = useCallback(
    async (project: string, session: string, id: string) => {
      // First, set the selection (for immediate UI feedback)
      selectDiagram(id);

      // Then fetch the full content
      try {
        const diagram = await api.getDiagram(project, session, id);
        if (diagram) {
          // Update the diagram in the store with its content
          updateDiagram(id, { content: diagram.content });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load diagram content';
        setError(message);
      }
    },
    [selectDiagram, updateDiagram]
  );

  /**
   * Select a document and fetch its full content
   */
  const selectDocumentWithContent = useCallback(
    async (project: string, session: string, id: string) => {
      // First, set the selection (for immediate UI feedback)
      selectDocument(id);

      // Then fetch the full content
      try {
        const document = await api.getDocument(project, session, id);
        if (document) {
          // Update the document in the store with its content
          updateDocument(id, { content: document.content });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load document content';
        setError(message);
      }
    },
    [selectDocument, updateDocument]
  );

  /**
   * Select a wireframe and fetch its full content
   */
  const selectWireframeWithContent = useCallback(
    async (project: string, session: string, id: string) => {
      // First, set the selection (for immediate UI feedback)
      selectWireframe(id);

      // Then fetch the full content
      try {
        const wireframe = await api.getWireframe(project, session, id);
        if (wireframe) {
          // Update the wireframe in the store with its content
          updateWireframe(id, { content: wireframe.content });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load wireframe content';
        setError(message);
      }
    },
    [selectWireframe, updateWireframe]
  );

  return {
    isLoading,
    error,
    loadSessions,
    loadSessionItems,
    refreshSessionItems,
    selectDiagramWithContent,
    selectDocumentWithContent,
    selectWireframeWithContent,
  };
}
