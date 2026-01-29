/**
 * TaskGraphCard Component
 *
 * Displays task execution graph diagram with real-time updates.
 * Shows task batches, their statuses, and dependencies in a visual format.
 *
 * Features:
 * - Real-time task graph updates via WebSocket
 * - Loading state with spinner
 * - Error message display
 * - Empty state when no diagram
 * - Optional close button
 * - Dark mode support
 */

import React from 'react';
import { Card } from '@/components/ai-ui/layout/Card';
import { Spinner } from '@/components/ai-ui/display/Spinner';
import { Alert } from '@/components/ai-ui/layout/Alert';
import { DiagramEmbed } from '@/components/ai-ui/mermaid/DiagramEmbed';
import { useTaskGraph } from '@/hooks/useTaskGraph';

export interface TaskGraphCardProps {
  /** Project absolute path */
  project: string;
  /** Session name */
  session: string;
  /** Optional callback when close button is clicked */
  onClose?: () => void;
}

/**
 * TaskGraphCard component for displaying task execution graph
 *
 * Renders task diagram with loading, error, and empty states.
 * Includes optional close button in card footer.
 */
export const TaskGraphCard: React.FC<TaskGraphCardProps> = ({
  project,
  session,
  onClose,
}) => {
  // Get task graph state from hook
  const { diagram, isLoading, error } = useTaskGraph(project, session);

  // Render loading state
  if (isLoading) {
    return (
      <Card title="Task Execution Graph">
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" label="Loading task graph..." />
        </div>
      </Card>
    );
  }

  // Render error state
  if (error) {
    return (
      <Card title="Task Execution Graph">
        <Alert
          type="error"
          title="Failed to load task graph"
          message={error.message}
        />
      </Card>
    );
  }

  // Render empty state
  if (!diagram) {
    return (
      <Card title="Task Execution Graph">
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            No tasks available
          </p>
        </div>
      </Card>
    );
  }

  // Render card with diagram and optional close button
  return (
    <div className="relative">
      <Card
        title="Task Execution Graph"
        footer="Task execution status"
      >
        <div className="bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
          <DiagramEmbed
            content={diagram}
            height="400px"
            className="w-full"
          />
        </div>
      </Card>
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          aria-label="Close task graph"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

export default TaskGraphCard;
