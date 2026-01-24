/**
 * FlagRow Component
 *
 * Single flag row for list displays showing topic, comment,
 * status badge, dates, and actions.
 */

import React from 'react';
import type { Flag, FlagStatus } from '../../types';
import { FlagActions } from './FlagActions';

export interface FlagRowProps {
  /** Flag data */
  flag: Flag;
  /** Action handler */
  onAction: (action: 'resolve' | 'dismiss' | 'reopen', reason?: string) => void;
  /** Navigate to topic handler */
  onGoToTopic: () => void;
}

/**
 * Get badge color classes based on flag status
 */
function getStatusBadgeClasses(status: FlagStatus): string {
  switch (status) {
    case 'open':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200';
    case 'addressed':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200';
    case 'resolved':
      return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200';
    case 'dismissed':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
}

/**
 * Format status for display
 */
function formatStatus(status: FlagStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * FlagRow component - Single row in flags list
 */
export const FlagRow: React.FC<FlagRowProps> = ({
  flag,
  onAction,
  onGoToTopic,
}) => {
  const handleResolve = () => onAction('resolve');
  const handleDismiss = (reason?: string) => onAction('dismiss', reason);
  const handleReopen = () => onAction('reopen');

  return (
    <tr className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      {/* Topic Name */}
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={onGoToTopic}
          className="
            text-sm font-medium
            text-accent-600 dark:text-accent-400
            hover:text-accent-700 dark:hover:text-accent-300
            hover:underline
            focus:outline-none focus:underline
          "
        >
          {flag.topicName}
        </button>
      </td>

      {/* Comment */}
      <td className="px-4 py-3">
        <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
          {flag.comment}
        </p>
        {flag.dismissedReason && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 italic">
            Dismissed: {flag.dismissedReason}
          </p>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span
          className={`
            inline-flex items-center
            px-2.5 py-0.5
            text-xs font-medium
            rounded-full
            ${getStatusBadgeClasses(flag.status)}
          `}
        >
          {formatStatus(flag.status)}
        </span>
      </td>

      {/* Created Date */}
      <td className="px-4 py-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {formatDate(flag.createdAt)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <FlagActions
          flag={flag}
          onResolve={handleResolve}
          onDismiss={handleDismiss}
          onReopen={handleReopen}
        />
      </td>
    </tr>
  );
};

export default FlagRow;
