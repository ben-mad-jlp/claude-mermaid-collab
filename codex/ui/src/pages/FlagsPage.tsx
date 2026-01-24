/**
 * FlagsPage
 *
 * Route page wrapping FlagsView with Layout and Header.
 * Displays all flags with filtering by status.
 */

import React from 'react';
import { Layout } from '../components/layout/Layout';
import { Header } from '../components/layout/Header';
import { FlagsView } from '../components/flags/FlagsView';
import type { FlagStatus } from '../types';

export interface FlagsPageProps {
  /** Initial tab selection */
  initialTab?: FlagStatus | 'all';
  /** Optional additional class name */
  className?: string;
}

/**
 * FlagsPage component - Full page for flag management
 */
export const FlagsPage: React.FC<FlagsPageProps> = ({
  initialTab = 'all',
  className = '',
}) => {
  return (
    <Layout className={className}>
      <div className="flex flex-col h-full">
        {/* Page Header */}
        <Header
          title="Flags"
          subtitle="Review and manage topic flags"
          breadcrumbs={[
            { label: 'Dashboard', href: '/' },
            { label: 'Flags' },
          ]}
        />

        {/* Flags View */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <FlagsView initialTab={initialTab} className="p-4" />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default FlagsPage;
