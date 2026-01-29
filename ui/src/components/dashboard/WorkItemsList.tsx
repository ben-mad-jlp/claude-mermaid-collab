/**
 * WorkItemsList Component
 *
 * Displays work items during implementation phase with optional task graph toggle.
 * Features:
 * - Renders work items as a list
 * - Shows "View Task Graph" button when phase === "implementation"
 * - Toggles TaskGraphCard visibility inline
 * - Integrates with collab session context
 * - Dark mode support
 */

import React, { useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import TaskGraphCard from './TaskGraphCard';

export interface WorkItemsListProps {
  /** Work items to display */
  items: Array<{
    id: string;
    label: string;
    completed?: boolean;
  }>;
  /** Project absolute path */
  project?: string;
  /** Session name */
  session?: string;
  /** Optional custom class name */
  className?: string;
}

/**
 * WorkItemsList component for displaying work items with task graph toggle
 *
 * Shows "View Task Graph" button at top when phase is "implementation".
 * Button toggles inline display of TaskGraphCard component.
 */
export const WorkItemsList: React.FC<WorkItemsListProps> = ({
  items,
  project,
  session,
  className = '',
}) => {
  const [showTaskGraph, setShowTaskGraph] = useState(false);

  // Get phase from session store
  const collabState = useSessionStore((state) => state.collabState);
  const phase = collabState?.state;
  const isImplementationPhase = phase === 'execute-batch' || phase === 'ready-to-implement';

  // Use provided project/session or fall back to current session from store
  const currentProject = project || collabState?.project;
  const currentSession = session || collabState?.session;

  // Only show button if we have both project and session
  const canShowGraph = isImplementationPhase && currentProject && currentSession;

  const handleCloseTaskGraph = () => {
    setShowTaskGraph(false);
  };

  return (
    <div className={`work-items-list space-y-4 ${className}`}>
      {/* View Task Graph Button - Only shown during implementation phase */}
      {canShowGraph && (
        <button
          onClick={() => setShowTaskGraph(!showTaskGraph)}
          className="w-full px-4 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          aria-pressed={showTaskGraph}
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M3 3v18h18" />
            <path d="M18 17V9M13 17v-5M8 17v-3" />
          </svg>
          {showTaskGraph ? 'Hide Task Graph' : 'View Task Graph'}
        </button>
      )}

      {/* Task Graph Card - Toggle visibility */}
      {showTaskGraph && canShowGraph && (
        <TaskGraphCard
          project={currentProject}
          session={currentSession}
          onClose={handleCloseTaskGraph}
        />
      )}

      {/* Work Items List */}
      {items && items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                item.completed
                  ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {/* Checkbox Icon */}
              <div
                className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  item.completed
                    ? 'bg-green-500 dark:bg-green-600 border-green-500 dark:border-green-600'
                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600'
                }`}
              >
                {item.completed && (
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>

              {/* Label */}
              <span
                className={`flex-1 ${
                  item.completed
                    ? 'text-gray-500 dark:text-gray-400 line-through'
                    : 'text-gray-900 dark:text-white'
                }`}
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No work items available
          </p>
        </div>
      )}
    </div>
  );
};

export default WorkItemsList;
