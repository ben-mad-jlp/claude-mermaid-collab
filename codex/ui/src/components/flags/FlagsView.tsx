/**
 * FlagsView Component
 *
 * Main flags view with tab bar for filtering by status.
 */

import React, { useState, useMemo } from 'react';
import type { FlagStatus } from '../../types';
import { useFlags } from '../../hooks/useFlags';
import { FlagsList } from './FlagsList';

export interface FlagsViewProps {
  /** Initial tab selection */
  initialTab?: FlagStatus | 'all';
  /** Optional additional class name */
  className?: string;
}

type TabValue = FlagStatus | 'all';

interface TabConfig {
  value: TabValue;
  label: string;
}

const TABS: TabConfig[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'addressed', label: 'Addressed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

/**
 * FlagsView component - Full flags view with tabs
 */
export const FlagsView: React.FC<FlagsViewProps> = ({
  initialTab = 'all',
  className = '',
}) => {
  const [activeTab, setActiveTab] = useState<TabValue>(initialTab);

  // Fetch all flags (no filter) to calculate counts
  const { flags: allFlags, isLoading, error, resolve, dismiss, reopen, refresh } = useFlags();

  // Filter flags based on active tab
  const filteredFlags = useMemo(() => {
    if (activeTab === 'all') {
      return allFlags;
    }
    return allFlags.filter((flag) => flag.status === activeTab);
  }, [allFlags, activeTab]);

  // Calculate counts for each tab
  const tabCounts = useMemo(() => {
    const counts: Record<TabValue, number> = {
      all: allFlags.length,
      open: 0,
      addressed: 0,
      resolved: 0,
      dismissed: 0,
    };
    allFlags.forEach((flag) => {
      counts[flag.status]++;
    });
    return counts;
  }, [allFlags]);

  const handleGoToTopic = (topicName: string) => {
    // Navigate to topic detail
    window.location.href = `/topics/${topicName}`;
  };

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Tab Bar */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-4" aria-label="Flag status tabs">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            const count = tabCounts[tab.value];

            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={`
                  inline-flex items-center gap-2
                  px-1 py-3
                  text-sm font-medium
                  border-b-2
                  transition-colors
                  focus:outline-none
                  ${
                    isActive
                      ? 'border-accent-500 text-accent-600 dark:border-accent-400 dark:text-accent-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                `}
                aria-selected={isActive}
                role="tab"
              >
                {tab.label}
                <span
                  className={`
                    inline-flex items-center justify-center
                    min-w-[20px] px-1.5 py-0.5
                    text-xs font-medium
                    rounded-full
                    ${
                      isActive
                        ? 'bg-accent-100 text-accent-600 dark:bg-accent-900/50 dark:text-accent-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    }
                  `}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Flags List */}
      <div className="flex-1">
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
                Loading flags...
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
                Failed to load flags
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

        {/* Flags List */}
        {!isLoading && !error && (
          <FlagsList
            flags={filteredFlags}
            onResolve={resolve}
            onDismiss={dismiss}
            onReopen={reopen}
            onGoToTopic={handleGoToTopic}
          />
        )}
      </div>

      {/* Results count */}
      {!isLoading && !error && filteredFlags.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Showing {filteredFlags.length} flag{filteredFlags.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
};

export default FlagsView;
