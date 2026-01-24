/**
 * TopicEditorPage
 *
 * Route page wrapping TopicEditor with Layout and Header.
 * Supports both create and edit modes.
 */

import React, { useCallback } from 'react';
import { Layout } from '../components/layout/Layout';
import { Header } from '../components/layout/Header';
import { TopicEditor, TopicDocuments } from '../components/topics/TopicEditor';
import { useTopic } from '../hooks/useTopic';

export interface TopicEditorPageProps {
  /** Topic name (undefined for create mode) */
  topicName?: string;
  /** Callback to navigate back after save/cancel */
  onBack?: () => void;
  /** Callback when save is successful */
  onSaveSuccess?: (topicName: string) => void;
  /** Optional additional class name */
  className?: string;
}

/**
 * TopicEditorPage component - Full page for topic create/edit
 */
export const TopicEditorPage: React.FC<TopicEditorPageProps> = ({
  topicName,
  onBack,
  onSaveSuccess,
  className = '',
}) => {
  const isCreateMode = !topicName;

  // Fetch existing topic data if in edit mode
  const { topic, isLoading, error } = useTopic(topicName || '');

  // Handle back/cancel navigation
  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else if (topicName) {
      // Navigate to topic detail
      window.location.href = `/topics/${topicName}`;
    } else {
      // Navigate to topics list
      window.location.href = '/topics';
    }
  }, [onBack, topicName]);

  // Handle save action
  const handleSave = useCallback(
    async (documents: TopicDocuments, editedBy: string, verify: boolean) => {
      try {
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 500));

        console.log('Saving topic:', {
          topicName: topicName || 'new-topic',
          documents,
          editedBy,
          verify,
        });

        if (onSaveSuccess) {
          onSaveSuccess(topicName || 'new-topic');
        } else {
          // Default navigation after save
          handleBack();
        }
      } catch (err) {
        console.error('Failed to save topic:', err);
        alert('Failed to save topic. Please try again.');
      }
    },
    [topicName, handleBack, onSaveSuccess]
  );

  // Generate breadcrumbs
  const breadcrumbs = isCreateMode
    ? [
        { label: 'Dashboard', href: '/' },
        { label: 'Topics', href: '/topics' },
        { label: 'Create' },
      ]
    : [
        { label: 'Dashboard', href: '/' },
        { label: 'Topics', href: '/topics' },
        { label: topicName!, href: `/topics/${topicName}` },
        { label: 'Edit' },
      ];

  // Loading state for edit mode
  if (!isCreateMode && isLoading) {
    return (
      <Layout className={className}>
        <div className="flex flex-col h-full">
          <Header
            title={isCreateMode ? 'Create Topic' : 'Edit Topic'}
            breadcrumbs={breadcrumbs}
          />
          <div className="flex-1 flex items-center justify-center">
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
        </div>
      </Layout>
    );
  }

  // Error state for edit mode
  if (!isCreateMode && error) {
    return (
      <Layout className={className}>
        <div className="flex flex-col h-full">
          <Header
            title="Edit Topic"
            breadcrumbs={breadcrumbs}
          />
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
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
              <button
                type="button"
                onClick={handleBack}
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
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Not found state for edit mode
  if (!isCreateMode && !topic) {
    return (
      <Layout className={className}>
        <div className="flex flex-col h-full">
          <Header
            title="Edit Topic"
            breadcrumbs={breadcrumbs}
          />
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
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
              <button
                type="button"
                onClick={handleBack}
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
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout className={className}>
      <div className="flex flex-col h-full">
        {/* Page Header */}
        <Header
          title={isCreateMode ? 'Create Topic' : 'Edit Topic'}
          breadcrumbs={breadcrumbs}
        />

        {/* Topic Editor Content */}
        <div className="flex-1 overflow-hidden">
          <TopicEditor
            topicName={topicName}
            initialDocuments={topic?.documents}
            onSave={handleSave}
            onCancel={handleBack}
            className="h-full"
          />
        </div>
      </div>
    </Layout>
  );
};

export default TopicEditorPage;
