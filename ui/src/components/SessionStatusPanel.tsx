/**
 * SessionStatusPanel Component
 *
 * Displays collab session status information including:
 * - Phase badge
 * - Current item being processed
 * - Last activity (relative time)
 * - Task progress bar (if tasks exist)
 *
 * Supports two layout variants:
 * - 'default': Stacked vertical layout (sidebar)
 * - 'inline': Horizontal layout (header)
 */

import { useSessionStore } from '@/stores/sessionStore';

/** Variant for SessionStatusPanel layout */
export type SessionStatusPanelVariant = 'default' | 'inline';

/** Props for SessionStatusPanel component */
export interface SessionStatusPanelProps {
  /** Layout variant - 'default' for sidebar (stacked), 'inline' for header (horizontal) */
  variant?: SessionStatusPanelVariant;
  /** Optional custom class name */
  className?: string;
}

/**
 * Formats ISO timestamp to relative time string
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return `${diffDays}d ago`;
  }
}

/**
 * Get phase badge color classes based on state or displayName
 */
function getPhaseColor(state: string | undefined, displayName: string | undefined): string {
  // Color based on state pattern (most reliable)
  if (state) {
    if (state.startsWith('brainstorm')) {
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    }
    if (state.startsWith('rough-draft') || state === 'build-task-graph') {
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
    }
    if (state === 'execute-batch' || state === 'ready-to-implement') {
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    }
    if (state === 'systematic-debugging') {
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    }
    if (state.startsWith('clear-') || state.endsWith('-router')) {
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
    }
    if (state === 'done' || state === 'workflow-complete' || state === 'cleanup') {
      return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
    }
    if (state === 'vibe-active') {
      return 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300';
    }
  }

  // Fallback: color based on displayName keywords
  if (displayName) {
    const lower = displayName.toLowerCase();
    if (lower.includes('exploring') || lower.includes('clarifying') || lower.includes('designing') || lower.includes('validating')) {
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    }
    if (lower.includes('interface') || lower.includes('pseudocode') || lower.includes('skeleton') || lower.includes('task')) {
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
    }
    if (lower.includes('executing') || lower.includes('ready')) {
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    }
    if (lower.includes('investigating')) {
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    }
    if (lower.includes('vibing')) {
      return 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300';
    }
  }

  // Default gray
  return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
}

/**
 * Session status panel showing collab state info
 * Displays phase, current item, last activity
 */
export function SessionStatusPanel({ variant = 'default', className }: SessionStatusPanelProps = {}) {
  const collabState = useSessionStore((state) => state.collabState);

  // Don't render if no collab state
  if (!collabState) {
    return null;
  }

  const { state, displayName, currentItem, lastActivity, completedTasks, pendingTasks, totalItems, documentedItems } = collabState;

  // Calculate progress for task-based (execution) or item-based (brainstorming/rough-draft)
  const isExecution = state === 'execute-batch' || state === 'ready-to-implement';
  // Treat undefined arrays as empty - either array existing with items counts as having task data
  const completed = completedTasks || [];
  const pending = pendingTasks || [];
  const hasTaskData = completed.length > 0 || pending.length > 0;
  const hasItemData = totalItems !== undefined && totalItems > 0 && documentedItems !== undefined;
  const isBrainstormingOrRoughDraft = state?.startsWith('brainstorm') || state?.startsWith('rough-draft');

  let progressValue = 0;
  let progressMax = 0;
  let progressLabel = '';
  let progressColorClass = '';

  if (isExecution && hasTaskData) {
    progressValue = completed.length;
    progressMax = completed.length + pending.length;
    progressLabel = 'Tasks';
    progressColorClass = 'bg-green-500 dark:bg-green-400';
  } else if (isBrainstormingOrRoughDraft && hasItemData) {
    progressValue = documentedItems;
    progressMax = totalItems;
    progressLabel = 'Items';
    progressColorClass = 'bg-blue-500 dark:bg-blue-400';
  }

  const showProgress = progressMax > 0;
  const progressPercentage = showProgress ? Math.round((progressValue / progressMax) * 100) : 0;

  // Inline variant: horizontal layout for header
  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-2 text-xs ${className || ''}`}>
        {/* Phase badge */}
        <span
          className={`px-2 py-0.5 rounded font-medium ${getPhaseColor(state, displayName)}`}
        >
          {displayName || 'Unknown'}
        </span>

        {/* Timestamp */}
        {lastActivity && (
          <span className="text-gray-400 dark:text-gray-500">
            {formatRelativeTime(lastActivity)}
          </span>
        )}

        {/* Current item indicator */}
        {currentItem !== null && (
          <span className="text-gray-500 dark:text-gray-400">
            · Item {currentItem}
          </span>
        )}

        {/* Inline progress bar (fixed width) */}
        {showProgress && (
          <div className="flex items-center gap-1 ml-1">
            <div className="w-20 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full ${progressColorClass} transition-all duration-300`}
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <span className="text-gray-600 dark:text-gray-300 font-medium whitespace-nowrap">
              {progressValue}/{progressMax}
            </span>
          </div>
        )}
      </div>
    );
  }

  // Default variant: stacked layout for sidebar
  return (
    <div className={`px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 ${className || ''}`}>
      {/* Row 1: Phase badge + timestamp + current item */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`px-2 py-0.5 rounded font-medium ${getPhaseColor(state, displayName)}`}
        >
          {displayName || 'Unknown'}
        </span>
        {lastActivity && (
          <span className="text-gray-400 dark:text-gray-500">
            {formatRelativeTime(lastActivity)}
          </span>
        )}
        {currentItem !== null && (
          <span className="text-gray-500 dark:text-gray-400">
            · Item {currentItem}
          </span>
        )}
      </div>

      {/* Row 3: Progress bar (if tasks/items exist) */}
      {showProgress && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500 dark:text-gray-400">{progressLabel}</span>
            <span className="text-gray-600 dark:text-gray-300 font-medium">
              {progressValue}/{progressMax}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${progressColorClass} transition-all duration-300`}
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

SessionStatusPanel.displayName = 'SessionStatusPanel';
