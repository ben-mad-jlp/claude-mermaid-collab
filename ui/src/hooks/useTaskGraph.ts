/**
 * useTaskGraph Hook
 *
 * Manages task graph state with real-time WebSocket updates.
 *
 * Provides:
 * - Initial fetch of task graph state on mount
 * - CustomEvent listener for task_graph_updated events
 * - Manual refresh function to re-fetch state
 * - Loading and error state tracking
 *
 * @param project - Project absolute path
 * @param session - Session name
 * @returns Task graph state and refresh function
 *
 * @example
 * ```tsx
 * function TaskGraphComponent() {
 *   const { diagram, batches, completedTasks, pendingTasks, isLoading, error, refresh } =
 *     useTaskGraph('/path/to/project', 'session-name');
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <div>
 *       <button onClick={refresh}>Refresh</button>
 *       {diagram && <DiagramViewer content={diagram} />}
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import { TaskBatch, TaskGraphUpdatedDetail } from '../types';

export interface UseTaskGraphReturn {
  diagram: string | null;
  batches: TaskBatch[];
  completedTasks: string[];
  pendingTasks: string[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing task graph state
 *
 * Fetches initial state on mount and listens for real-time updates via CustomEvent.
 * Automatically cleans up event listeners on unmount.
 */
export function useTaskGraph(project: string, session: string): UseTaskGraphReturn {
  const [diagram, setDiagram] = useState<string | null>(null);
  const [batches, setBatches] = useState<TaskBatch[]>([]);
  const [completedTasks, setCompletedTasks] = useState<string[]>([]);
  const [pendingTasks, setPendingTasks] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Fetch task graph from API endpoint
   */
  const fetchTaskGraph = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Build API URL with project and session in path
      const encodedProject = encodeURIComponent(project);
      const encodedSession = encodeURIComponent(session);
      const url = `/api/projects/${encodedProject}/sessions/${encodedSession}/task-graph`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch task graph: ${response.statusText}`);
      }

      const data = await response.json();

      // Update state with API response
      setDiagram(data.diagram || null);
      setBatches(data.batches || []);
      setCompletedTasks(data.completedTasks || []);
      setPendingTasks(data.pendingTasks || []);
      setIsLoading(false);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);
      console.error('Failed to fetch task graph:', error);
    }
  }, [project, session]);

  /**
   * Handle task_graph_updated CustomEvent
   */
  const handleTaskGraphUpdate = useCallback((event: Event) => {
    const customEvent = event as CustomEvent<TaskGraphUpdatedDetail>;
    try {
      const payload = customEvent.detail.payload;

      // Update state with payload from event
      setDiagram(payload.diagram || null);
      setBatches(payload.batches as TaskBatch[] || []);
      setCompletedTasks(payload.completedTasks || []);
      setPendingTasks(payload.pendingTasks || []);
      setError(null);
    } catch (err) {
      console.warn('Failed to parse task_graph_updated event:', err);
    }
  }, []);

  /**
   * Set up event listener and fetch initial state on mount
   */
  useEffect(() => {
    // Fetch initial state
    fetchTaskGraph();

    // Listen for real-time updates via CustomEvent
    window.addEventListener('task_graph_updated', handleTaskGraphUpdate);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('task_graph_updated', handleTaskGraphUpdate);
    };
  }, [fetchTaskGraph, handleTaskGraphUpdate]);

  return {
    diagram,
    batches,
    completedTasks,
    pendingTasks,
    isLoading,
    error,
    refresh: fetchTaskGraph,
  };
}
