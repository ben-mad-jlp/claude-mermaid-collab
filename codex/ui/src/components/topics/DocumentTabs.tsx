/**
 * DocumentTabs Component
 *
 * Tab navigation for document types within a topic.
 * Supports Conceptual, Technical, Files, and Related document tabs.
 */

import React from 'react';
import type { DocumentType } from '../../types';

export interface DocumentTabsProps {
  /** Currently active tab */
  activeTab: DocumentType;
  /** Callback when tab changes */
  onTabChange: (tab: DocumentType) => void;
  /** Whether conceptual tab has a draft */
  conceptualHasDraft?: boolean;
  /** Whether technical tab has a draft */
  technicalHasDraft?: boolean;
  /** Whether files tab has a draft */
  filesHasDraft?: boolean;
  /** Whether related tab has a draft */
  relatedHasDraft?: boolean;
  /** Optional additional class name */
  className?: string;
}

/**
 * Tab configuration
 */
interface TabConfig {
  id: DocumentType;
  label: string;
  icon: React.ReactNode;
}

/**
 * Tab definitions with icons
 */
const TABS: TabConfig[] = [
  {
    id: 'conceptual',
    label: 'Conceptual',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838l-2.727 1.17 1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zm5.99 7.176A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
      </svg>
    ),
  },
  {
    id: 'technical',
    label: 'Technical',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    id: 'files',
    label: 'Files',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    id: 'related',
    label: 'Related',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
      </svg>
    ),
  },
];

/**
 * Get draft status for a tab
 */
function getHasDraft(
  tabId: DocumentType,
  props: DocumentTabsProps
): boolean {
  switch (tabId) {
    case 'conceptual':
      return props.conceptualHasDraft ?? false;
    case 'technical':
      return props.technicalHasDraft ?? false;
    case 'files':
      return props.filesHasDraft ?? false;
    case 'related':
      return props.relatedHasDraft ?? false;
    default:
      return false;
  }
}

/**
 * DocumentTabs component - Tab navigation for document types
 */
export const DocumentTabs: React.FC<DocumentTabsProps> = (props) => {
  const { activeTab, onTabChange, className = '' } = props;

  const handleKeyDown = (e: React.KeyboardEvent, tabId: DocumentType) => {
    const currentIndex = TABS.findIndex((t) => t.id === tabId);
    let nextIndex: number | null = null;

    if (e.key === 'ArrowRight') {
      nextIndex = currentIndex === TABS.length - 1 ? 0 : currentIndex + 1;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = currentIndex === 0 ? TABS.length - 1 : currentIndex - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      onTabChange(TABS[nextIndex].id);
    }
  };

  return (
    <div
      role="tablist"
      className={`
        flex
        border-b border-gray-200 dark:border-gray-700
        ${className}
      `}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const hasDraft = getHasDraft(tab.id, props);

        return (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, tab.id)}
            className={`
              relative
              flex items-center gap-2
              px-4 py-3
              text-sm font-medium
              border-b-2
              transition-colors
              focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent-500 dark:focus:ring-accent-400
              ${
                isActive
                  ? 'border-accent-600 dark:border-accent-500 text-accent-600 dark:text-accent-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }
            `}
          >
            {tab.icon}
            <span>{tab.label}</span>

            {/* Draft indicator */}
            {hasDraft && (
              <span
                className="
                  absolute top-2 right-2
                  w-2 h-2
                  rounded-full
                  bg-blue-500 dark:bg-blue-400
                "
                title="Has draft changes"
              />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default DocumentTabs;
