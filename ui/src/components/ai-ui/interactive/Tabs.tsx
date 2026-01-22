import React, { useState, ReactNode } from 'react';

export interface TabContent {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  content: ReactNode;
}

export interface TabsProps {
  tabs: TabContent[];
  activeTab?: string;
  variant?: 'default' | 'pills' | 'underline';
  fullWidth?: boolean;
  onTabChange?: (tabId: string) => void;
  className?: string;
}

/**
 * Tabs Component
 * Tabbed content sections with switching capability
 *
 * Features:
 * - Multiple tab variants (default, pills, underline)
 * - Optional icons for tabs
 * - Disable individual tabs
 * - Full-width option
 * - Keyboard navigation support
 * - Dark mode support
 * - Accessible with ARIA attributes
 */
export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  variant = 'default',
  fullWidth = false,
  onTabChange,
  className = '',
}) => {
  const [active, setActive] = useState(activeTab || tabs[0]?.id || '');

  const handleTabChange = (tabId: string) => {
    if (!tabs.find((t) => t.id === tabId)?.disabled) {
      setActive(tabId);
      onTabChange?.(tabId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, tabId: string) => {
    const tabIndex = tabs.findIndex((t) => t.id === tabId);
    let nextTabIndex: number | null = null;

    if (e.key === 'ArrowRight') {
      nextTabIndex = tabIndex === tabs.length - 1 ? 0 : tabIndex + 1;
    } else if (e.key === 'ArrowLeft') {
      nextTabIndex = tabIndex === 0 ? tabs.length - 1 : tabIndex - 1;
    }

    if (nextTabIndex !== null) {
      e.preventDefault();
      const nextTab = tabs[nextTabIndex];
      if (!nextTab.disabled) {
        handleTabChange(nextTab.id);
      }
    }
  };

  const activeTabContent = tabs.find((t) => t.id === active);

  return (
    <div className={`tabs w-full ${className}`}>
      {/* Tab Navigation */}
      <div
        role="tablist"
        className={`
          flex
          ${fullWidth ? 'w-full' : 'w-auto'}
          border-b border-gray-200 dark:border-gray-700
          ${
            variant === 'pills'
              ? 'gap-2 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg border-0'
              : ''
          }
        `}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          const isDisabled = tab.disabled;

          let tabClass = 'px-4 py-3 font-medium transition-all focus:outline-none focus:ring-2 focus:ring-blue-500';

          if (variant === 'pills') {
            tabClass = `
              px-4 py-2 rounded-md font-medium transition-all
              focus:outline-none focus:ring-2 focus:ring-blue-500
              ${
                isActive
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : isDisabled
                  ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }
            `;
          } else if (variant === 'underline') {
            tabClass = `
              px-4 py-3 font-medium border-b-2 transition-all
              focus:outline-none focus:ring-2 focus:ring-blue-500
              ${
                isActive
                  ? 'border-blue-600 dark:border-blue-500 text-blue-600 dark:text-blue-400'
                  : isDisabled
                  ? 'border-transparent text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
              }
            `;
          } else {
            // default variant
            tabClass = `
              px-4 py-3 font-medium border-b-2 transition-all
              focus:outline-none focus:ring-2 focus:ring-blue-500
              ${
                isActive
                  ? 'border-blue-600 dark:border-blue-500 text-gray-900 dark:text-white'
                  : isDisabled
                  ? 'border-transparent text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }
            `;
          }

          return (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              disabled={isDisabled}
              className={tabClass}
              onClick={() => handleTabChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, tab.id)}
            >
              <span className="inline-flex items-center gap-2">
                {tab.icon && <span>{tab.icon}</span>}
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTabContent && (
        <div
          role="tabpanel"
          id={`panel-${active}`}
          aria-labelledby={`tab-${active}`}
          className="pt-4"
        >
          {activeTabContent.content}
        </div>
      )}
    </div>
  );
};

export default Tabs;
