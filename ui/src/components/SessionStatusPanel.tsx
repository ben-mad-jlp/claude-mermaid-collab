/**
 * SessionStatusPanel Component
 *
 * Displays collab session status information including:
 * - Phase badge
 * - Current item being processed
 * - Last activity (relative time)
 * - Task progress bar (if tasks exist)
 */

import { useSessionStore } from '@/stores/sessionStore';

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
 * Get display-friendly phase name
 */
function formatPhase(phase: string): string {
  const phaseMap: Record<string, string> = {
    'brainstorming': 'Brainstorming',
    'rough-draft/interface': 'Interface',
    'rough-draft/pseudocode': 'Pseudocode',
    'rough-draft/skeleton': 'Skeleton',
    'implementation': 'Implementation',
  };
  return phaseMap[phase] || phase;
}

/**
 * Get phase badge color classes
 */
function getPhaseColor(phase: string): string {
  if (phase.startsWith('rough-draft')) {
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  }
  switch (phase) {
    case 'brainstorming':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    case 'implementation':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
  }
}

/**
 * Session status panel showing collab state info
 * Displays phase, current item, last activity
 */
export function SessionStatusPanel() {
  const collabState = useSessionStore((state) => state.collabState);

  // Don't render if no collab state
  if (!collabState) {
    return null;
  }

  const { phase, currentItem, lastActivity } = collabState;

  return (
    <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
      {/* Row 1: Phase badge + current item */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`px-2 py-0.5 rounded font-medium ${getPhaseColor(phase)}`}
        >
          {formatPhase(phase)}
        </span>
        {currentItem !== null && (
          <span className="text-gray-500 dark:text-gray-400">
            Item {currentItem}
          </span>
        )}
      </div>

      {/* Row 2: Last activity */}
      {lastActivity && (
        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {formatRelativeTime(lastActivity)}
        </div>
      )}
    </div>
  );
}

SessionStatusPanel.displayName = 'SessionStatusPanel';
