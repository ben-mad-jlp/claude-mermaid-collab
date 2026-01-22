/**
 * SessionCard Component
 *
 * Card displaying session information with:
 * - Session name and project path
 * - Current phase badge
 * - Last activity timestamp
 * - Item count
 * - Click to select functionality
 * - Hover states and styling
 *
 * Integrates with useSession hook for session management.
 */

import React from 'react';
import { Session } from '@/types';

export interface SessionCardProps {
  /** Session to display */
  session: Session;
  /** Whether this session is currently selected */
  isSelected?: boolean;
  /** Callback when card is clicked */
  onClick?: () => void;
  /** Optional custom class name */
  className?: string;
}

/**
 * Format relative time from ISO date string or timestamp
 */
function formatRelativeTime(
  timestamp: string | number | undefined
): string {
  if (!timestamp) return '';

  const date =
    typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * SessionCard component for displaying session information
 */
export const SessionCard: React.FC<SessionCardProps> = ({
  session,
  isSelected = false,
  onClick,
  className = '',
}) => {
  return (
    <button
      data-testid={`session-card-${session.name}`}
      onClick={onClick}
      className={`
        group
        w-full
        bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700
        rounded-lg
        p-4
        text-left
        transition-all
        hover:shadow-md dark:hover:shadow-gray-900/50
        hover:border-accent-300 dark:hover:border-accent-600
        ${
          isSelected
            ? 'ring-2 ring-accent-500 dark:ring-accent-400 border-accent-400 dark:border-accent-500'
            : 'hover:border-accent-300 dark:hover:border-accent-600'
        }
        ${className}
      `}
    >
      {/* Card Header */}
      <div className="flex items-start justify-between mb-3">
        {/* Session Icon and Name */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={`
              flex-shrink-0
              p-2
              rounded-lg
              transition-colors
              ${
                isSelected
                  ? 'bg-accent-100 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 group-hover:bg-accent-50 dark:group-hover:bg-accent-900/20 group-hover:text-accent-600 dark:group-hover:text-accent-400'
              }
            `}
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M20 7L12 3L4 7M20 7L12 11M20 7V17L12 21M12 11L4 7M12 11V21M4 7V17L12 21" />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h3
              className={`
                text-sm font-semibold truncate
                transition-colors
                ${
                  isSelected
                    ? 'text-accent-700 dark:text-accent-300'
                    : 'text-gray-900 dark:text-white group-hover:text-accent-700 dark:group-hover:text-accent-300'
                }
              `}
              title={session.name}
            >
              {session.name}
            </h3>

            {/* Project Path */}
            <p
              className="
                text-xs text-gray-500 dark:text-gray-400
                truncate
                mt-1
              "
              title={session.project}
            >
              {session.project}
            </p>
          </div>
        </div>
      </div>

      {/* Card Content */}
      <div className="space-y-2">
        {/* Phase Badge */}
        {session.phase && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
              Phase:
            </span>
            <span
              className={`
                px-2 py-1
                text-xs font-medium
                rounded
                transition-colors
                ${
                  isSelected
                    ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }
              `}
            >
              {session.phase}
            </span>
          </div>
        )}

        {/* Item Count */}
        {session.itemCount !== undefined && (
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path
                fillRule="evenodd"
                d="M4 5a2 2 0 012-2 1 1 0 000 2H3v7a2 2 0 002 2h10a2 2 0 002-2V7h-3a1 1 0 000-2 2 2 0 01-2-2h-1a2 2 0 01-2 2 1 1 0 000 2H3v7a2 2 0 002 2h10a2 2 0 002-2v-7h3a2 2 0 01-2 2 1 1 0 100 2h2a2 2 0 002-2V5a2 2 0 00-2-2h-1V3a2 2 0 00-2-2H6a2 2 0 00-2 2v2H3a2 2 0 00-2 2zm0 0h14v7H4V5z"
                clipRule="evenodd"
              />
            </svg>
            <span>{session.itemCount} items</span>
          </div>
        )}

        {/* Last Activity */}
        {session.lastActivity && (
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z"
                clipRule="evenodd"
              />
            </svg>
            <span>Active {formatRelativeTime(session.lastActivity)}</span>
          </div>
        )}
      </div>
    </button>
  );
};

export default SessionCard;
