/**
 * MissingTopicRow Component
 *
 * Single missing topic row showing topic name, request count,
 * dates, and Create/Dismiss buttons.
 */

import React from 'react';
import type { MissingTopic } from '../../types';

export interface MissingTopicRowProps {
  /** Missing topic data */
  topic: MissingTopic;
  /** Create topic handler */
  onCreate: () => void;
  /** Dismiss request handler */
  onDismiss: () => void;
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
 * MissingTopicRow component - Single row in missing topics list
 */
export const MissingTopicRow: React.FC<MissingTopicRowProps> = ({
  topic,
  onCreate,
  onDismiss,
}) => {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      {/* Topic Name */}
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-gray-900 dark:text-white">
          {topic.topicName}
        </span>
      </td>

      {/* Request Count */}
      <td className="px-4 py-3">
        <span
          className="
            inline-flex items-center
            px-2.5 py-0.5
            text-xs font-medium
            rounded-full
            bg-purple-100 text-purple-800
            dark:bg-purple-900/50 dark:text-purple-200
          "
        >
          {topic.requestCount} request{topic.requestCount !== 1 ? 's' : ''}
        </span>
      </td>

      {/* First Requested */}
      <td className="px-4 py-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {formatDate(topic.firstRequestedAt)}
        </span>
      </td>

      {/* Last Requested */}
      <td className="px-4 py-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {formatDate(topic.lastRequestedAt)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Create Button */}
          <button
            type="button"
            onClick={onCreate}
            className="
              inline-flex items-center gap-1
              px-3 py-1.5
              text-xs font-medium
              text-white
              bg-accent-600 hover:bg-accent-700
              dark:bg-accent-500 dark:hover:bg-accent-600
              rounded-md
              focus:outline-none focus:ring-2 focus:ring-accent-500
              transition-colors
            "
            aria-label={`Create topic ${topic.topicName}`}
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            Create
          </button>

          {/* Dismiss Button */}
          <button
            type="button"
            onClick={onDismiss}
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
            aria-label={`Dismiss request for ${topic.topicName}`}
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
        </div>
      </td>
    </tr>
  );
};

export default MissingTopicRow;
