/**
 * TaskGraphView Component
 *
 * Displays the implementation task graph in the main content area. The graph
 * canvas is the SAME React Flow <FleetGraph> the Bridge uses (one graph, not
 * two) — fed from the active session's work-graph todos, with no worker/claim
 * overlay (FleetGraph's subs/escalations are optional). useTaskGraph is still
 * the source of the loading / error / empty gating for the implementation phase.
 */

import React from 'react';
import { useTaskGraph } from '@/hooks/useTaskGraph';
import { FleetGraph } from '@/components/supervisor/bridge/fleet/FleetGraph';
import { useSessionStore } from '@/stores/sessionStore';

export interface TaskGraphViewProps {
  /** Project path */
  project: string;
  /** Session name */
  session: string;
}

/**
 * Task graph view component that displays the implementation task graph
 */
export const TaskGraphView: React.FC<TaskGraphViewProps> = ({ project, session }) => {
  const { diagram, isLoading, error, refresh } = useTaskGraph(project, session);
  // The work-graph todos for the active session — FleetGraph derives epics,
  // todos and dependency edges from these (no extra fetch: the session store
  // already maintains this list for the current session).
  const sessionTodos = useSessionStore((s) => s.sessionTodos);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-info-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading task graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-danger-50 dark:bg-danger-900 p-6 rounded-lg max-w-md text-center">
          <h3 className="text-danger-900 dark:text-danger-100 font-semibold mb-2">
            Error loading task graph
          </h3>
          <p className="text-danger-700 dark:text-danger-200 text-sm mb-4">
            {error.message}
          </p>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-danger-600 text-white rounded-lg hover:bg-danger-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!diagram) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-gray-500 dark:text-gray-400">No task graph available</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Task graph will appear during implementation phase
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex">
      <FleetGraph todos={sessionTodos} />
    </div>
  );
};

export default TaskGraphView;
