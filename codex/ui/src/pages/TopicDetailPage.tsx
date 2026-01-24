/**
 * TopicDetailPage
 *
 * Route page wrapping TopicDetail with Layout and Header.
 * Displays full topic details with document viewer.
 */

import React, { useCallback } from 'react';
import { Layout } from '../components/layout/Layout';
import { Header } from '../components/layout/Header';
import { TopicDetail } from '../components/topics/TopicDetail';

export interface TopicDetailPageProps {
  /** Topic name/slug from route params */
  topicName: string;
  /** Callback to navigate back to topic list */
  onBack?: () => void;
  /** Callback when edit is requested */
  onEdit?: (topicName: string) => void;
  /** Callback when delete is requested */
  onDelete?: (topicName: string) => void;
  /** Optional additional class name */
  className?: string;
}

/**
 * TopicDetailPage component - Full page for topic detail view
 */
export const TopicDetailPage: React.FC<TopicDetailPageProps> = ({
  topicName,
  onBack,
  onEdit,
  onDelete,
  className = '',
}) => {
  // Handle back navigation
  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      // Default navigation behavior
      window.location.href = '/topics';
    }
  }, [onBack]);

  // Handle edit action
  const handleEdit = useCallback(
    (name: string) => {
      if (onEdit) {
        onEdit(name);
      } else {
        // Default navigation behavior
        window.location.href = `/topics/${name}/edit`;
      }
    },
    [onEdit]
  );

  // Handle delete action
  const handleDelete = useCallback(
    (name: string) => {
      if (onDelete) {
        onDelete(name);
      } else {
        // Default confirmation behavior
        if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
          console.log('Delete topic:', name);
          // Navigate back after delete
          handleBack();
        }
      }
    },
    [onDelete, handleBack]
  );

  return (
    <Layout className={className}>
      <div className="flex flex-col h-full">
        {/* Page Header */}
        <Header
          title="Topic Details"
          breadcrumbs={[
            { label: 'Dashboard', href: '/' },
            { label: 'Topics', href: '/topics' },
            { label: topicName },
          ]}
        />

        {/* Topic Detail Content */}
        <div className="flex-1 overflow-hidden">
          <TopicDetail
            topicName={topicName}
            onBack={handleBack}
            onEdit={handleEdit}
            onDelete={handleDelete}
            className="h-full"
          />
        </div>
      </div>
    </Layout>
  );
};

export default TopicDetailPage;
