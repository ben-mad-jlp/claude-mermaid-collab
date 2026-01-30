/**
 * useWireframeHistory Hook
 *
 * Fetches and subscribes to wireframe history updates from the API.
 * Provides access to the wireframe's change history and ability to
 * retrieve content at specific timestamps.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import type { WireframeHistory, UseWireframeHistoryReturn } from '@/types/history';

/**
 * Hook for fetching and managing wireframe history
 *
 * @param wireframeId - The wireframe ID to fetch history for, or null
 * @returns Wireframe history state and utility functions
 *
 * @example
 * ```tsx
 * function WireframeHistoryPanel({ wireframeId }: { wireframeId: string }) {
 *   const { history, isLoading, error, refetch, getVersionAt } = useWireframeHistory(wireframeId);
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
export function useWireframeHistory(wireframeId: string | null): UseWireframeHistoryReturn {
  const [history, setHistory] = useState<WireframeHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { currentSession } = useSession();
  const project = currentSession?.project ?? null;
  const session = currentSession?.name ?? null;

  const fetchHistory = useCallback(async () => {
    if (!wireframeId || !project || !session) {
      setHistory(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ project, session });
      const response = await fetch(`/api/wireframe/${wireframeId}/history?${params}`);

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
  }, [wireframeId, project, session]);

  const getVersionAt = useCallback(
    async (timestamp: string): Promise<string | null> => {
      if (!wireframeId || !project || !session) return null;

      try {
        const params = new URLSearchParams({ project, session, timestamp });
        const response = await fetch(`/api/wireframe/${wireframeId}/version?${params}`);

        if (response.ok) {
          const data = await response.json();
          return data.content;
        }
      } catch (err) {
        // Ignore errors, return null
      }
      return null;
    },
    [wireframeId, project, session]
  );

  // Fetch on mount and when wireframeId changes
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // TODO: Subscribe to WebSocket for wireframe_history_updated messages
  // Refetch when message.id === wireframeId

  return { history, isLoading, error, refetch: fetchHistory, getVersionAt };
}
