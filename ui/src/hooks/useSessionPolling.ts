/**
 * useSessionPolling Hook
 *
 * Polls session state at regular intervals as a fallback mechanism
 * when WebSocket updates may be missed. Works alongside the WebSocket
 * handler for dual-channel status sync.
 */

import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '../stores/sessionStore';

/**
 * Hook that polls session state at regular intervals
 *
 * @param project - Project path (null to disable polling)
 * @param session - Session name (null to disable polling)
 * @param intervalMs - Polling interval in milliseconds (default: 5000)
 *
 * @example
 * ```tsx
 * function App() {
 *   const { currentSession } = useSession();
 *   useSessionPolling(
 *     currentSession?.project ?? null,
 *     currentSession?.name ?? null,
 *     5000
 *   );
 * }
 * ```
 */
export function useSessionPolling(
  project: string | null,
  session: string | null,
  intervalMs = 5000
): void {
  const { collabState, setCollabState } = useSessionStore(
    useShallow((state) => ({
      collabState: state.collabState,
      setCollabState: state.setCollabState,
    }))
  );

  // Use ref to track lastActivity to avoid stale closure issues
  const lastActivityRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Update ref when collabState changes
    lastActivityRef.current = collabState?.lastActivity;
  }, [collabState?.lastActivity]);

  useEffect(() => {
    // Skip polling if project or session is not provided
    if (!project || !session) {
      return;
    }

    const poll = async () => {
      try {
        const url = `/api/session-state?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
        const response = await fetch(url);

        if (!response.ok) {
          // Silently ignore errors - polling should be resilient
          return;
        }

        const newState = await response.json();

        // Only update if state has changed (compare lastActivity)
        if (newState.lastActivity !== lastActivityRef.current) {
          setCollabState(newState);
        }
      } catch {
        // Silently ignore network errors - polling continues on next interval
      }
    };

    // Initial fetch
    poll();

    // Set up interval
    const interval = setInterval(poll, intervalMs);

    // Cleanup on unmount or dependency change
    return () => clearInterval(interval);
  }, [project, session, intervalMs, setCollabState]);
}
