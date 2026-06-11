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
import { embedsApi } from '@/api/embeds';
import { useSessionStore } from '@/stores/sessionStore';
import { getSessionItemsCache, setSessionItemsCache, isCacheStale } from '@/lib/sessionItemsCache';
import type { SessionItemsSnapshot } from '@/lib/sessionItemsCache';

export interface UseDataLoaderReturn {
  /** Whether a data loading operation is in progress */
  isLoading: boolean;
  /** Error message if the last operation failed */
  error: string | null;
  /** Load all available sessions from the API */
  loadSessions: () => Promise<void>;
  /** Load diagrams, documents, designs, and spreadsheets for a specific session */
  loadSessionItems: (serverId: string, project: string, session: string) => Promise<void>;
  /** Refresh session items while preserving current selection */
  refreshSessionItems: (serverId: string, project: string, session: string) => Promise<void>;
  /** Select a diagram and fetch its content */
  selectDiagramWithContent: (serverId: string, project: string, session: string, id: string) => Promise<void>;
  /** Select a document and fetch its content */
  selectDocumentWithContent: (serverId: string, project: string, session: string, id: string) => Promise<void>;
  /** Select a design and fetch its content */
  selectDesignWithContent: (serverId: string, project: string, session: string, id: string) => Promise<void>;
  /** Select a spreadsheet and fetch its content */
  selectSpreadsheetWithContent: (serverId: string, project: string, session: string, id: string) => Promise<void>;
}

/**
 * Hook to load sessions and session items from the API
 *
 * @returns Object with loading state, error state, and load functions
 */
export function useDataLoader(): UseDataLoaderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get store setters
  const setSessions = useSessionStore((state) => state.setSessions);
  const setDiagrams = useSessionStore((state) => state.setDiagrams);
  const setDocuments = useSessionStore((state) => state.setDocuments);
  const setDesigns = useSessionStore((state) => state.setDesigns);
  const setSpreadsheets = useSessionStore((state) => state.setSpreadsheets);
  const setSnippets = useSessionStore((state) => state.setSnippets);
  const setEmbeds = useSessionStore((state) => state.setEmbeds);
  const setImages = useSessionStore((state) => state.setImages);
  const selectDiagram = useSessionStore((state) => state.selectDiagram);
  const selectDocument = useSessionStore((state) => state.selectDocument);
  const selectDesign = useSessionStore((state) => state.selectDesign);
  const selectSpreadsheet = useSessionStore((state) => state.selectSpreadsheet);
  const updateDiagram = useSessionStore((state) => state.updateDiagram);
  const updateDocument = useSessionStore((state) => state.updateDocument);
  const updateDesign = useSessionStore((state) => state.updateDesign);
  const updateSpreadsheet = useSessionStore((state) => state.updateSpreadsheet);
  const setCollabState = useSessionStore((state) => state.setCollabState);

  /**
   * Load all available sessions from the API
   */
  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const sessions = await api.getSessions();
      setSessions([...sessions].sort((a, b) => a.name.localeCompare(b.name)));
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
    async (serverId: string, project: string, session: string): Promise<import('@/types').CollabState | null> => {
      if (!session) return null;
      try {
        const state = await api.getSessionState(serverId, project, session);
        setCollabState(state);
        return state;
      } catch (err) {
        console.error('Failed to load collab state:', err);
        setCollabState(null);
        return null;
      }
    },
    [setCollabState]
  );

  /**
   * Load diagrams, documents, and designs for a specific session
   */
  const loadSessionItems = useCallback(
    async (serverId: string, project: string, session: string) => {
      // Only `session` is required. A falsy serverId is valid — it means "no
      // specific server", and apiFetch already routes that to a direct
      // local-origin fetch. Requiring serverId here silently stranded
      // cross-project sessions discovered without a server binding (e.g.
      // stud_feeder/cad): the guard returned early, the store stayed empty,
      // and Refresh (which calls this) became a no-op. (artifact-staleness bug)
      if (!session) return;
      setError(null);
      let showedSpinner = false;

      // Phase 1 — serve from cache immediately (no spinner) if warm
      const cached = getSessionItemsCache(project, session);
      if (cached && !isCacheStale(cached)) {
        setDiagrams(cached.diagrams);
        setDocuments(cached.documents);
        setDesigns(cached.designs);
        setSpreadsheets(cached.spreadsheets);
        setSnippets(cached.snippets);
        setEmbeds(cached.embeds);
        setImages(cached.images);
        setCollabState(cached.collabState);
        // Still run background fetch to revalidate — don't show spinner
      } else {
        showedSpinner = true;
        setIsLoading(true);
      }

      try {
        const [diagrams, documents, designs, spreadsheets, snippets, embeds, images] = await Promise.all([
          api.getDiagrams(serverId, project, session),
          api.getDocuments(serverId, project, session),
          api.getDesigns(serverId, project, session),
          api.getSpreadsheets(serverId, project, session),
          api.getSnippets(serverId, project, session),
          embedsApi.fetchEmbeds(serverId, session, project),
          api.listImages(serverId, project, session),
        ]);
        setDiagrams(diagrams);
        setDocuments(documents);
        setDesigns(designs);
        setSpreadsheets(spreadsheets);
        setSnippets(snippets);
        setEmbeds(embeds);
        setImages(images);

        // Also load collab state — capture return value directly to avoid cross-session store races
        const collabState = await loadCollabState(serverId, project, session);

        // Phase 2 — write fresh snapshot to cache
        const snapshot: SessionItemsSnapshot = {
          diagrams,
          documents,
          designs,
          spreadsheets,
          snippets,
          embeds,
          images,
          collabState,
          fetchedAt: Date.now(),
        };
        setSessionItemsCache(project, session, snapshot);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load session items';
        setError(message);
      } finally {
        if (showedSpinner) setIsLoading(false);
      }
    },
    [setDiagrams, setDocuments, setDesigns, setSpreadsheets, setSnippets, setEmbeds, setImages, setCollabState, loadCollabState]
  );

  /**
   * Refresh session items while preserving current selection
   */
  const refreshSessionItems = useCallback(
    async (serverId: string, project: string, session: string) => {
      if (!session) return;
      // Capture current selection
      const { selectedDiagramId, selectedDocumentId, selectedDesignId, selectedSpreadsheetId } = useSessionStore.getState();

      // Load fresh data
      await loadSessionItems(serverId, project, session);

      // Restore selection if items still exist
      const { diagrams: newDiagrams, documents: newDocuments, designs: newDesigns, spreadsheets: newSpreadsheets } = useSessionStore.getState();

      if (selectedDiagramId && newDiagrams.find((d) => d.id === selectedDiagramId)) {
        selectDiagram(selectedDiagramId);
      } else if (selectedDocumentId && newDocuments.find((d) => d.id === selectedDocumentId)) {
        selectDocument(selectedDocumentId);
      } else if (selectedDesignId && newDesigns.find((d) => d.id === selectedDesignId)) {
        selectDesign(selectedDesignId);
      } else if (selectedSpreadsheetId && newSpreadsheets.find((s) => s.id === selectedSpreadsheetId)) {
        selectSpreadsheet(selectedSpreadsheetId);
      }
    },
    [loadSessionItems, selectDiagram, selectDocument, selectDesign, selectSpreadsheet]
  );

  /**
   * Select a diagram and fetch its full content
   */
  const selectDiagramWithContent = useCallback(
    async (serverId: string, project: string, session: string, id: string) => {
      // First, set the selection (for immediate UI feedback)
      selectDiagram(id);

      // Then fetch the full content
      try {
        const diagram = await api.getDiagram(serverId, project, session, id);
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
    async (serverId: string, project: string, session: string, id: string) => {
      // First, set the selection (for immediate UI feedback)
      selectDocument(id);

      // Then fetch the full content
      try {
        const document = await api.getDocument(serverId, project, session, id);
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
   * Select a design and fetch its full content
   */
  const selectDesignWithContent = useCallback(
    async (serverId: string, project: string, session: string, id: string) => {
      // First, set the selection (for immediate UI feedback)
      selectDesign(id);

      // Then fetch the full content
      try {
        const design = await api.getDesign(serverId, project, session, id);
        if (design) {
          // Update the design in the store with its content
          updateDesign(id, { content: design.content });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load design content';
        setError(message);
      }
    },
    [selectDesign, updateDesign]
  );

  /**
   * Select a spreadsheet and fetch its full content
   */
  const selectSpreadsheetWithContent = useCallback(
    async (serverId: string, project: string, session: string, id: string) => {
      selectSpreadsheet(id);

      try {
        const spreadsheet = await api.getSpreadsheet(serverId, project, session, id);
        if (spreadsheet) {
          updateSpreadsheet(id, { content: spreadsheet.content });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load spreadsheet content';
        setError(message);
      }
    },
    [selectSpreadsheet, updateSpreadsheet]
  );

  return {
    isLoading,
    error,
    loadSessions,
    loadSessionItems,
    refreshSessionItems,
    selectDiagramWithContent,
    selectDocumentWithContent,
    selectDesignWithContent,
    selectSpreadsheetWithContent,
  };
}
