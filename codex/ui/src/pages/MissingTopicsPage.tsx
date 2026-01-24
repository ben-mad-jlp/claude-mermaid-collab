/**
 * MissingTopicsPage
 *
 * Route page wrapping MissingTopicsView with Layout and Header.
 * Displays missing topic requests for review.
 */

import React, { useCallback } from 'react';
import { Layout } from '../components/layout/Layout';
import { Header } from '../components/layout/Header';
import { MissingTopicsView } from '../components/missing/MissingTopicsView';

export interface MissingTopicsPageProps {
  /** Callback when navigating to create a topic */
  onNavigateToEditor?: (topicName: string) => void;
  /** Optional additional class name */
  className?: string;
}

/**
 * MissingTopicsPage component - Full page for missing topics management
 */
export const MissingTopicsPage: React.FC<MissingTopicsPageProps> = ({
  onNavigateToEditor,
  className = '',
}) => {
  // Handle creating a new topic
  const handleCreateTopic = useCallback(
    (topicName: string) => {
      if (onNavigateToEditor) {
        onNavigateToEditor(topicName);
      } else {
        // Default navigation behavior - go to editor with pre-filled name
        window.location.href = `/topics/new?name=${encodeURIComponent(topicName)}`;
      }
    },
    [onNavigateToEditor]
  );

  return (
    <Layout className={className}>
      <div className="flex flex-col h-full">
        {/* Page Header */}
        <Header
          title="Missing Topics"
          subtitle="Topics requested by users that don't exist yet"
          breadcrumbs={[
            { label: 'Dashboard', href: '/' },
            { label: 'Missing Topics' },
          ]}
        />

        {/* Missing Topics View */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <MissingTopicsView
              onCreateTopic={handleCreateTopic}
              className="p-4"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default MissingTopicsPage;
