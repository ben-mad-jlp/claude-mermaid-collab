import React from 'react';
import type { TerminalSession } from '../../types/terminal';

export interface MobileTerminalTabBarProps {
  tabs: TerminalSession[];
  activeTabId: string | null;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
  onTabAdd: () => void;
}

/**
 * MobileTerminalTabBar - Mobile-optimized terminal tab bar
 *
 * A simplified version of TerminalTabBar for mobile:
 * - Horizontally scrollable tabs
 * - Active tab highlighting
 * - Close button (X) on each tab
 * - Add button (+) to create new terminal
 * - Compact mobile-friendly sizing
 * - No drag-and-drop (too difficult on mobile)
 */
export const MobileTerminalTabBar: React.FC<MobileTerminalTabBarProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabAdd,
}) => {
  return (
    <div
      className="mobile-terminal-tab-bar flex items-center bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600"
      role="tablist"
      data-testid="mobile-terminal-tab-bar"
    >
      {/* Scrollable tabs container */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto px-1 py-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              data-tab-id={tab.id}
              data-testid={`terminal-tab-${tab.id}`}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
              onClick={() => onTabSelect(tab.id)}
            >
              <span className="truncate max-w-[80px]">{tab.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none"
                aria-label={`Close ${tab.name}`}
                data-testid={`close-tab-${tab.id}`}
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* Add tab button */}
      <button
        type="button"
        onClick={onTabAdd}
        className="flex-shrink-0 px-3 py-1 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        aria-label="Add new terminal"
        data-testid="add-terminal-tab"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
      </button>
    </div>
  );
};

MobileTerminalTabBar.displayName = 'MobileTerminalTabBar';
