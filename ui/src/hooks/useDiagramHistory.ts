/**
 * useDiagramHistory Hook
 *
 * Fetches and subscribes to diagram history updates from the API.
 * Provides access to the diagram's change history and ability to
 * retrieve content at specific timestamps.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import type { DiagramHistory, UseDiagramHistoryReturn } from '@/types/history';

/**
 * Hook for fetching and managing diagram history
 *
 * @param diagramId - The diagram ID to fetch history for, or null
 * @returns Diagram history state and utility functions
 *
 * @example
 * ```tsx
 * function DiagramHistoryPanel({ diagramId }: { diagramId: string }) {
 *   const { history, isLoading, error, refetch, getVersionAt } = useDiagramHistory(diagramId);
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
export function useDiagramHistory(diagramId: string | null): UseDiagramHistoryReturn {
  const [history, setHistory] = useState<DiagramHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { currentSession } = useSession();
  const project = currentSession?.project ?? null;
  const session = currentSession?.name ?? null;

  const fetchHistory = useCallback(async () => {
    if (!diagramId || !project || !session) {
      setHistory(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ project, session });
      const response = await fetch(`/api/diagram/${diagramId}/history?${params}`);

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
  }, [diagramId, project, session]);

  const getVersionAt = useCallback(
    async (timestamp: string): Promise<string | null> => {
      if (!diagramId || !project || !session) return null;

      try {
        const params = new URLSearchParams({ project, session, timestamp });
        const response = await fetch(`/api/diagram/${diagramId}/version?${params}`);

        if (response.ok) {
          const data = await response.json();
          return data.content;
        }
      } catch (err) {
        // Ignore errors, return null
      }
      return null;
    },
    [diagramId, project, session]
  );

  // Fetch on mount and when diagramId changes
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // TODO: Subscribe to WebSocket for diagram_history_updated messages
  // Refetch when message.id === diagramId

  return { history, isLoading, error, refetch: fetchHistory, getVersionAt };
}
