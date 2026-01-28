/**
 * useDocumentHistory Hook
 *
 * Fetches and subscribes to document history updates from the API.
 * Provides access to the document's change history and ability to
 * retrieve content at specific timestamps.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import type { DocumentHistory, UseDocumentHistoryReturn } from '@/types/history';

/**
 * Hook for fetching and managing document history
 *
 * @param documentId - The document ID to fetch history for, or null
 * @returns Document history state and utility functions
 *
 * @example
 * ```tsx
 * function HistoryPanel({ documentId }: { documentId: string }) {
 *   const { history, isLoading, error, refetch, getVersionAt } = useDocumentHistory(documentId);
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error}</div>;
 *   if (!history) return <div>No history available</div>;
 *
 *   return (
 *     <div>
 *       <p>Original: {history.original}</p>
 *       <ul>
 *         {history.changes.map((change, i) => (
 *           <li key={i} onClick={() => getVersionAt(change.timestamp)}>
 *             {change.timestamp}
 *           </li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 */
export function useDocumentHistory(documentId: string | null): UseDocumentHistoryReturn {
  const [history, setHistory] = useState<DocumentHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { currentSession } = useSession();
  const project = currentSession?.project ?? null;
  const session = currentSession?.name ?? null;

  const fetchHistory = useCallback(async () => {
    if (!documentId || !project || !session) {
      setHistory(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ project, session });
      const response = await fetch(`/api/document/${documentId}/history?${params}`);

      if (response.status === 404) {
        setHistory(null); // No history yet, not an error
      } else if (response.ok) {
        const data = await response.json();
        setHistory(data);
      } else {
        setError('Failed to load history');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  }, [documentId, project, session]);

  const getVersionAt = useCallback(
    async (timestamp: string): Promise<string | null> => {
      if (!documentId || !project || !session) return null;

      try {
        const params = new URLSearchParams({ project, session, timestamp });
        const response = await fetch(`/api/document/${documentId}/version?${params}`);

        if (response.ok) {
          const data = await response.json();
          return data.content;
        }
      } catch (err) {
        // Ignore errors, return null
      }
      return null;
    },
    [documentId, project, session]
  );

  // Fetch on mount and when documentId changes
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // TODO: Subscribe to WebSocket for document_history_updated messages
  // Refetch when message.id === documentId

  return { history, isLoading, error, refetch: fetchHistory, getVersionAt };
}
