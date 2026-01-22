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
  /** Load diagrams and documents for a specific session */
  loadSessionItems: (project: string, session: string) => Promise<void>;
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
   * Load diagrams and documents for a specific session
   */
  const loadSessionItems = useCallback(
    async (project: string, session: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const diagrams = await api.getDiagrams(project, session);
        const documents = await api.getDocuments(project, session);
        setDiagrams(diagrams);
        setDocuments(documents);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load session items';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [setDiagrams, setDocuments]
  );

  return {
    isLoading,
    error,
    loadSessions,
    loadSessionItems,
  };
}
