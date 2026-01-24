/**
 * TopicRow Component
 *
 * Single topic row for list displays showing name, confidence badge,
 * flag count, and draft indicator.
 */

import React from 'react';
import type { TopicSummary, ConfidenceTier } from '../../types';

export interface TopicRowProps {
  /** Topic summary data */
  topic: TopicSummary;
  /** Click handler for navigation */
  onClick: (topic: TopicSummary) => void;
  /** Whether this row is selected */
  isSelected?: boolean;
  /** Optional additional class name */
  className?: string;
}

/**
 * Get badge color classes based on confidence tier
 */
function getConfidenceBadgeClasses(confidence: ConfidenceTier): string {
  switch (confidence) {
    case 'high':
      return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200';
    case 'low':
      return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
}

/**
 * Format confidence tier for display
 */
function formatConfidence(confidence: ConfidenceTier): string {
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

/**
 * TopicRow component - Single row in topic list
 */
export const TopicRow: React.FC<TopicRowProps> = ({
  topic,
  onClick,
  isSelected = false,
  className = '',
}) => {
  const handleClick = () => {
    onClick(topic);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(topic);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`
        flex items-center justify-between
        px-4 py-3
        bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700
        rounded-lg
        cursor-pointer
        transition-all
        hover:shadow-md hover:border-accent-300 dark:hover:border-accent-600
        focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400
        ${isSelected ? 'ring-2 ring-accent-500 dark:ring-accent-400 border-accent-500 dark:border-accent-400' : ''}
        ${className}
      `}
      aria-selected={isSelected}
    >
      {/* Left side: Name and indicators */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Topic icon */}
        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700">
          <svg
            className="w-5 h-5 text-gray-500 dark:text-gray-400"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
          </svg>
        </div>

        {/* Topic name */}
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {topic.name}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {topic.accessCount} access{topic.accessCount !== 1 ? 'es' : ''}
          </p>
        </div>
      </div>

      {/* Right side: Badges */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Draft indicator */}
        {topic.hasDraft && (
          <span
            className="
              inline-flex items-center
              px-2 py-0.5
              text-xs font-medium
              rounded-full
              bg-blue-100 text-blue-800
              dark:bg-blue-900/50 dark:text-blue-200
            "
          >
            Draft
          </span>
        )}

        {/* Flag count badge */}
        {topic.openFlagCount > 0 && (
          <span
            className="
              inline-flex items-center gap-1
              px-2 py-0.5
              text-xs font-medium
              rounded-full
              bg-orange-100 text-orange-800
              dark:bg-orange-900/50 dark:text-orange-200
            "
          >
            <svg
              className="w-3 h-3"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"
                clipRule="evenodd"
              />
            </svg>
            {topic.openFlagCount}
          </span>
        )}

        {/* Confidence badge */}
        <span
          className={`
            inline-flex items-center
            px-2.5 py-0.5
            text-xs font-medium
            rounded-full
            ${getConfidenceBadgeClasses(topic.confidence)}
          `}
        >
          {formatConfidence(topic.confidence)}
        </span>

        {/* Chevron */}
        <svg
          className="w-5 h-5 text-gray-400 dark:text-gray-500"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </div>
  );
};

export default TopicRow;
