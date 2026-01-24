/**
 * TopicBrowser Component
 *
 * Topic list component with filtering and sorting capabilities.
 * Displays a FilterBar and list of TopicRow components.
 */

import React, { useState, useCallback } from 'react';
import type { TopicSummary, TopicFilters, TopicSortBy, SortOrder } from '../../types';
import { useTopics } from '../../hooks/useTopics';
import { FilterBar } from '../common/FilterBar';
import { TopicRow } from './TopicRow';

export interface TopicBrowserProps {
  /** Callback when a topic is selected */
  onTopicSelect: (topic: TopicSummary) => void;
  /** Currently selected topic name */
  selectedTopicName?: string;
  /** Optional additional class name */
  className?: string;
}

/**
 * TopicBrowser component - Full topic list with filters
 */
export const TopicBrowser: React.FC<TopicBrowserProps> = ({
  onTopicSelect,
  selectedTopicName,
  className = '',
}) => {
  // Filter and sort state
  const [filters, setFilters] = useState<TopicFilters>({});
  const [sortBy, setSortBy] = useState<TopicSortBy>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Fetch topics with current filters and sorting
  const { topics, isLoading, error, refresh } = useTopics(filters, sortBy, sortOrder);

  // Handle filter changes
  const handleFiltersChange = useCallback((newFilters: TopicFilters) => {
    setFilters(newFilters);
  }, []);

  // Handle sort changes
  const handleSortByChange = useCallback((newSortBy: TopicSortBy) => {
    setSortBy(newSortBy);
  }, []);

  const handleSortOrderChange = useCallback((newSortOrder: SortOrder) => {
    setSortOrder(newSortOrder);
  }, []);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        sortBy={sortBy}
        onSortByChange={handleSortByChange}
        sortOrder={sortOrder}
        onSortOrderChange={handleSortOrderChange}
      />

      {/* Topic List */}
      <div className="flex flex-col gap-2">
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
                Loading topics...
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
                Failed to load topics
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
                <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                No topics found
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Try adjusting your filters or create a new topic.
              </p>
            </div>
          </div>
        )}

        {/* Topic List */}
        {!isLoading && !error && topics.length > 0 && (
          <div className="flex flex-col gap-2" role="list">
            {topics.map((topic) => (
              <TopicRow
                key={topic.name}
                topic={topic}
                onClick={onTopicSelect}
                isSelected={topic.name === selectedTopicName}
              />
            ))}
          </div>
        )}
      </div>

      {/* Results count */}
      {!isLoading && !error && topics.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Showing {topics.length} topic{topics.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
};

export default TopicBrowser;
