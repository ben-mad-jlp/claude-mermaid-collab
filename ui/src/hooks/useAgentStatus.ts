/**
 * useAgentStatus Hook
 *
 * Provides real-time agent status tracking with:
 * - HTTP polling from /api/status endpoint
 * - WebSocket real-time updates
 * - Configurable polling interval
 * - Graceful error handling
 * - Loading state management
 */

import { useEffect, useState, useCallback } from 'react';

export interface AgentStatusState {
  agentStatus: 'working' | 'waiting' | 'idle';
  agentMessage?: string;
  agentIsLoading: boolean;
}

/**
 * Hook for monitoring agent status
 *
 * Fetches status from localhost:3737/api/status and listens
 * to WebSocket events for real-time updates.
 *
 * @param pollInterval - Polling interval in milliseconds (default: 2000)
 * @returns Current agent status, message, and loading state
 *
 * @example
 * ```tsx
 * function StatusDisplay() {
 *   const { status, message, isLoading } = useAgentStatus(2000);
 *
 *   if (isLoading) return <div>Loading...</div>;
 *
 *   return (
 *     <div>
 *       Status: {status}
 *       {message && <p>{message}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAgentStatus(pollInterval = 2000): AgentStatusState {
  const [state, setState] = useState<AgentStatusState>({
    agentStatus: 'idle',
    agentMessage: undefined,
    agentIsLoading: true,
  });

  // Fetch status from API
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:3737/api/status');
      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }
      const data = await response.json();

      // Validate response has required status field
      if (data.status && ['working', 'waiting', 'idle'].includes(data.status)) {
        setState((prev) => ({
          agentStatus: data.status,
          agentMessage: data.message || undefined,
          agentIsLoading: false,
        }));
      } else {
        // Keep previous state if response is invalid
        setState((prev) => ({
          ...prev,
          agentIsLoading: false,
        }));
      }
    } catch (error) {
      // Log error but don't throw - keep last known state
      console.error('Failed to fetch agent status:', error);
      setState((prev) => ({
        ...prev,
        agentIsLoading: false,
      }));
    }
  }, []);

  // Setup polling and WebSocket listeners on mount
  useEffect(() => {
    // Initial fetch
    fetchStatus();

    // Setup polling interval
    const pollId = setInterval(fetchStatus, pollInterval);

    // Setup WebSocket listener for real-time updates
    const handleStatusChanged = (event: CustomEvent) => {
      const { status, message } = event.detail || {};
      if (status && ['working', 'waiting', 'idle'].includes(status)) {
        setState({
          agentStatus: status,
          agentMessage: message,
          agentIsLoading: false,
        });
      }
    };

    window.addEventListener('status_changed', handleStatusChanged as EventListener);

    // Cleanup on unmount
    return () => {
      clearInterval(pollId);
      window.removeEventListener('status_changed', handleStatusChanged as EventListener);
    };
  }, [pollInterval, fetchStatus]);

  return state;
}
