/**
 * useWireframe Hook
 *
 * Provides React integration for wireframe operations with:
 * - Fetching wireframe JSON from the API
 * - WebSocket subscription for live updates
 * - Loading and error state management
 * - Automatic cleanup on unmount
 */

import { useState, useEffect } from 'react';
import { getWebSocketClient } from '../lib/websocket';

export interface UseWireframeReturn {
  /** The loaded wireframe data */
  wireframe: unknown | null;
  /** Whether the wireframe is currently loading */
  loading: boolean;
  /** Error message if the load failed */
  error: string | null;
}

/**
 * Hook for fetching and subscribing to wireframe updates
 *
 * Fetches wireframe JSON from the API based on project, session, and id.
 * Subscribes to WebSocket updates for live changes. Handles loading and error
 * states, and cleans up subscriptions on unmount.
 *
 * @param project - The project identifier
 * @param session - The session identifier
 * @param id - The wireframe ID
 * @returns Wireframe state with data, loading, and error
 *
 * @example
 * ```tsx
 * function WireframeViewer() {
 *   const { wireframe, loading, error } = useWireframe('my-project', 'my-session', 'wireframe-1');
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <ErrorDisplay error={error} />;
 *   if (!wireframe) return <NotFound />;
 *
 *   return <WireframeRenderer wireframe={wireframe} />;
 * }
 * ```
 */
export function useWireframe(
  project: string,
  session: string,
  id: string
): UseWireframeReturn {
  const [wireframe, setWireframe] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch wireframe from API and subscribe to WebSocket updates
  useEffect(() => {
    let isMounted = true;
    const wsClient = getWebSocketClient();
    let wsUnsubscribe: (() => void) | null = null;

    const fetchWireframe = async () => {
      try {
        setLoading(true);
        setError(null);

        // Construct URL with query parameters
        const url = new URL('/api/wireframe/' + id, window.location.origin);
        url.searchParams.set('project', project);
        url.searchParams.set('session', session);

        const response = await fetch(url.toString());

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (isMounted) {
          setWireframe(data.content);
        }
      } catch (err) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          setError(message);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    // Fetch the wireframe
    fetchWireframe();

    // Subscribe to WebSocket updates
    const subscription = wsClient.onMessage((message) => {
      // Only update if the message is for this specific wireframe
      if (message.id === id && message.content) {
        setWireframe(message.content);
      }
    });

    wsUnsubscribe = subscription.unsubscribe;

    // Cleanup
    return () => {
      isMounted = false;
      if (wsUnsubscribe) {
        wsUnsubscribe();
      }
    };
  }, [project, session, id]);

  return { wireframe, loading, error };
}
