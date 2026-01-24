/**
 * FlagActions Component
 *
 * Status-aware action buttons for flags.
 * Shows Resolve/Dismiss for open flags, Reopen for resolved/dismissed.
 */

import React from 'react';
import type { Flag } from '../../types';

export interface FlagActionsProps {
  /** The flag to show actions for */
  flag: Flag;
  /** Resolve action handler */
  onResolve: () => void;
  /** Dismiss action handler with optional reason */
  onDismiss: (reason?: string) => void;
  /** Reopen action handler */
  onReopen: () => void;
}

/**
 * FlagActions component - Action buttons based on flag status
 */
export const FlagActions: React.FC<FlagActionsProps> = ({
  flag,
  onResolve,
  onDismiss,
  onReopen,
}) => {
  const isOpen = flag.status === 'open';
  const isAddressed = flag.status === 'addressed';
  const canResolveOrDismiss = isOpen || isAddressed;
  const canReopen = flag.status === 'resolved' || flag.status === 'dismissed';

  return (
    <div className="flex items-center gap-2">
      {canResolveOrDismiss && (
        <>
          {/* Resolve Button */}
          <button
            type="button"
            onClick={onResolve}
            className="
              inline-flex items-center gap-1
              px-3 py-1.5
              text-xs font-medium
              text-green-700 dark:text-green-300
              bg-green-50 dark:bg-green-900/30
              border border-green-200 dark:border-green-800
              rounded-md
              hover:bg-green-100 dark:hover:bg-green-900/50
              focus:outline-none focus:ring-2 focus:ring-green-500
              transition-colors
            "
            aria-label="Resolve flag"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Resolve
          </button>

          {/* Dismiss Button */}
          <button
            type="button"
            onClick={() => onDismiss()}
            className="
              inline-flex items-center gap-1
              px-3 py-1.5
              text-xs font-medium
              text-gray-700 dark:text-gray-300
              bg-gray-50 dark:bg-gray-700
              border border-gray-200 dark:border-gray-600
              rounded-md
              hover:bg-gray-100 dark:hover:bg-gray-600
              focus:outline-none focus:ring-2 focus:ring-gray-500
              transition-colors
            "
            aria-label="Dismiss flag"
          >
            <svg
              className="w-3.5 h-3.5"
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
            Dismiss
          </button>
        </>
      )}

      {canReopen && (
        /* Reopen Button */
        <button
          type="button"
          onClick={onReopen}
          className="
            inline-flex items-center gap-1
            px-3 py-1.5
            text-xs font-medium
            text-blue-700 dark:text-blue-300
            bg-blue-50 dark:bg-blue-900/30
            border border-blue-200 dark:border-blue-800
            rounded-md
            hover:bg-blue-100 dark:hover:bg-blue-900/50
            focus:outline-none focus:ring-2 focus:ring-blue-500
            transition-colors
          "
          aria-label="Reopen flag"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
              clipRule="evenodd"
            />
          </svg>
          Reopen
        </button>
      )}
    </div>
  );
};

export default FlagActions;
