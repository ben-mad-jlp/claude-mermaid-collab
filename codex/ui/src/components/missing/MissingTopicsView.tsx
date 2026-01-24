/**
 * MissingTopicsView Component
 *
 * View for managing missing topic requests.
 */

import React, { useState } from 'react';
import { useMissingTopics } from '../../hooks/useMissingTopics';
import { MissingTopicRow } from './MissingTopicRow';
import { ConfirmDialog } from '../common/ConfirmDialog';

export interface MissingTopicsViewProps {
  /** Handler for creating a new topic */
  onCreateTopic: (topicName: string) => void;
  /** Optional additional class name */
  className?: string;
}

/**
 * MissingTopicsView component - Table of missing topic requests
 */
export const MissingTopicsView: React.FC<MissingTopicsViewProps> = ({
  onCreateTopic,
  className = '',
}) => {
  const { topics, isLoading, error, dismiss, refresh } = useMissingTopics();
  const [dismissingTopic, setDismissingTopic] = useState<string | null>(null);

  const handleCreate = (topicName: string) => {
    onCreateTopic(topicName);
  };

  const handleDismissClick = (topicName: string) => {
    setDismissingTopic(topicName);
  };

  const handleDismissConfirm = async () => {
    if (dismissingTopic) {
      const currentUser = 'current-user'; // Would come from auth context
      await dismiss(dismissingTopic, currentUser);
      setDismissingTopic(null);
    }
  };

  const handleDismissCancel = () => {
    setDismissingTopic(null);
  };

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <svg
              className="animate-spin w-8 h-8 text-accent-500"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Loading missing topics...
            </span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/50">
            <svg
              className="w-6 h-6 text-red-600 dark:text-red-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Failed to load missing topics
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {error.message}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="
              px-4 py-2
              text-sm font-medium
              text-white
              bg-accent-600 hover:bg-accent-700
              dark:bg-accent-500 dark:hover:bg-accent-600
              rounded-md
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500
              transition-colors
            "
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && topics.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700">
            <svg
              className="w-6 h-6 text-gray-400 dark:text-gray-500"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              No missing topics
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              All requested topics have been addressed.
            </p>
          </div>
        </div>
      )}

      {/* Topics Table */}
      {!isLoading && !error && topics.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Topic Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Requests
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  First Requested
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Last Requested
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {topics.map((topic) => (
                <MissingTopicRow
                  key={topic.topicName}
                  topic={topic}
                  onCreate={() => handleCreate(topic.topicName)}
                  onDismiss={() => handleDismissClick(topic.topicName)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Results count */}
      {!isLoading && !error && topics.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Showing {topics.length} missing topic{topics.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Dismiss Confirmation Dialog */}
      <ConfirmDialog
        open={dismissingTopic !== null}
        title="Dismiss Topic Request"
        message={`Are you sure you want to dismiss the request for "${dismissingTopic}"? This will remove it from the missing topics list.`}
        confirmLabel="Dismiss"
        cancelLabel="Cancel"
        onConfirm={handleDismissConfirm}
        onCancel={handleDismissCancel}
      />
    </div>
  );
};

export default MissingTopicsView;
