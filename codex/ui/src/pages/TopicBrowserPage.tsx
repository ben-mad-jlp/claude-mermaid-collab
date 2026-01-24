/**
 * TopicBrowserPage
 *
 * Route page wrapping TopicBrowser with Layout and Header.
 * Displays the full topic list with filtering capabilities.
 */

import React, { useCallback } from 'react';
import type { TopicSummary } from '../types';
import { Layout } from '../components/layout/Layout';
import { Header } from '../components/layout/Header';
import { TopicBrowser } from '../components/topics/TopicBrowser';

export interface TopicBrowserPageProps {
  /** Callback when a topic is selected for viewing */
  onTopicSelect?: (topicName: string) => void;
  /** Optional additional class name */
  className?: string;
}

/**
 * TopicBrowserPage component - Full page for topic browsing
 */
export const TopicBrowserPage: React.FC<TopicBrowserPageProps> = ({
  onTopicSelect,
  className = '',
}) => {
  // Handle topic selection
  const handleTopicSelect = useCallback(
    (topic: TopicSummary) => {
      if (onTopicSelect) {
        onTopicSelect(topic.name);
      } else {
        // Default navigation behavior
        window.location.href = `/topics/${topic.name}`;
      }
    },
    [onTopicSelect]
  );

  return (
    <Layout className={className}>
      <div className="flex flex-col h-full">
        {/* Page Header */}
        <Header
          title="Topics"
          subtitle="Browse and manage knowledge base topics"
          breadcrumbs={[
            { label: 'Dashboard', href: '/' },
            { label: 'Topics' },
          ]}
          actions={
            <button
              type="button"
              className="
                inline-flex items-center gap-2
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
              <svg
                className="w-4 h-4"
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
              New Topic
            </button>
          }
        />

        {/* Topic Browser */}
        <div className="flex-1 overflow-y-auto p-6">
          <TopicBrowser onTopicSelect={handleTopicSelect} />
        </div>
      </div>
    </Layout>
  );
};

export default TopicBrowserPage;
