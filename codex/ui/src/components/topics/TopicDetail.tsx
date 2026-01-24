/**
 * TopicDetail Component
 *
 * Full topic detail view with metadata, document tabs,
 * content viewer, and action buttons.
 */

import React, { useState } from 'react';
import type { DocumentType, TopicFull, ConfidenceTier } from '../../types';
import { useTopic } from '../../hooks/useTopic';
import { DocumentTabs } from './DocumentTabs';
import { DocumentViewer } from './DocumentViewer';

export interface TopicDetailProps {
  /** Topic name/slug to display */
  topicName: string;
  /** Callback when edit is requested */
  onEdit?: (topicName: string) => void;
  /** Callback when delete is requested */
  onDelete?: (topicName: string) => void;
  /** Callback to navigate back */
  onBack?: () => void;
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
 * Format date for display
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * TopicDetail component - Full topic detail view
 */
export const TopicDetail: React.FC<TopicDetailProps> = ({
  topicName,
  onEdit,
  onDelete,
  onBack,
  className = '',
}) => {
  const { topic, isLoading, error, verify, refresh } = useTopic(topicName);
  const [activeTab, setActiveTab] = useState<DocumentType>('conceptual');
  const [isVerifying, setIsVerifying] = useState(false);

  // Handle verify action
  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      await verify();
    } finally {
      setIsVerifying(false);
    }
  };

  // Get current document content based on active tab
  const getCurrentContent = (topic: TopicFull): string => {
    return topic.documents[activeTab] || '';
  };

  // Loading state
  if (isLoading) {
    return (
      <div
        className={`
          flex items-center justify-center
          h-full min-h-[400px]
          ${className}
        `}
      >
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
            Loading topic...
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={`
          flex flex-col items-center justify-center
          h-full min-h-[400px]
          gap-4
          ${className}
        `}
      >
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
            Failed to load topic
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {error.message}
          </p>
        </div>
        <div className="flex gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="
                px-4 py-2
                text-sm font-medium
                text-gray-700 dark:text-gray-300
                bg-white dark:bg-gray-700
                border border-gray-300 dark:border-gray-600
                rounded-md
                hover:bg-gray-50 dark:hover:bg-gray-600
                focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500
                transition-colors
              "
            >
              Go Back
            </button>
          )}
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
      </div>
    );
  }

  // Not found state
  if (!topic) {
    return (
      <div
        className={`
          flex flex-col items-center justify-center
          h-full min-h-[400px]
          gap-4
          ${className}
        `}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700">
          <svg
            className="w-6 h-6 text-gray-400 dark:text-gray-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Topic not found
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            The topic "{topicName}" could not be found.
          </p>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="
              px-4 py-2
              text-sm font-medium
              text-gray-700 dark:text-gray-300
              bg-white dark:bg-gray-700
              border border-gray-300 dark:border-gray-600
              rounded-md
              hover:bg-gray-50 dark:hover:bg-gray-600
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500
              transition-colors
            "
          >
            Go Back
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header with metadata */}
      <div className="flex-shrink-0 px-6 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        {/* Back button and title */}
        <div className="flex items-center gap-4 mb-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="
                p-1.5
                text-gray-500 dark:text-gray-400
                hover:text-gray-700 dark:hover:text-gray-300
                hover:bg-gray-100 dark:hover:bg-gray-700
                rounded-md
                focus:outline-none focus:ring-2 focus:ring-accent-500
                transition-colors
              "
              aria-label="Go back"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            {topic.name}
          </h1>
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
          {topic.hasDraft && (
            <span
              className="
                inline-flex items-center
                px-2.5 py-0.5
                text-xs font-medium
                rounded-full
                bg-blue-100 text-blue-800
                dark:bg-blue-900/50 dark:text-blue-200
              "
            >
              Draft
            </span>
          )}
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-6 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1.5">
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                clipRule="evenodd"
              />
            </svg>
            <span>Verified: {formatDate(topic.lastVerified)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>{topic.accessCount} accesses</span>
          </div>
          {topic.openFlagCount > 0 && (
            <div className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
              <svg
                className="w-4 h-4"
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
              <span>{topic.openFlagCount} open flag{topic.openFlagCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={handleVerify}
            disabled={isVerifying}
            className="
              inline-flex items-center gap-2
              px-4 py-2
              text-sm font-medium
              text-white
              bg-green-600 hover:bg-green-700
              dark:bg-green-500 dark:hover:bg-green-600
              rounded-md
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500
              transition-colors
            "
          >
            {isVerifying ? (
              <>
                <svg
                  className="animate-spin w-4 h-4"
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
                Verifying...
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
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
                Verify
              </>
            )}
          </button>

          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(topicName)}
              className="
                inline-flex items-center gap-2
                px-4 py-2
                text-sm font-medium
                text-gray-700 dark:text-gray-300
                bg-white dark:bg-gray-700
                border border-gray-300 dark:border-gray-600
                rounded-md
                hover:bg-gray-50 dark:hover:bg-gray-600
                focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500
                transition-colors
              "
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              Edit
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(topicName)}
              className="
                inline-flex items-center gap-2
                px-4 py-2
                text-sm font-medium
                text-red-700 dark:text-red-400
                bg-white dark:bg-gray-700
                border border-red-300 dark:border-red-600
                rounded-md
                hover:bg-red-50 dark:hover:bg-red-900/20
                focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500
                transition-colors
              "
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Document tabs */}
      <DocumentTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="flex-shrink-0 bg-white dark:bg-gray-800"
      />

      {/* Document content */}
      <div className="flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900">
        <DocumentViewer
          content={getCurrentContent(topic)}
          className="h-full"
        />
      </div>
    </div>
  );
};

export default TopicDetail;
