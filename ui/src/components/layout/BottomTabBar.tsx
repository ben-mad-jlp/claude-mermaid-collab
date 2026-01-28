/**
 * BottomTabBar Component
 *
 * Fixed bottom navigation bar for mobile layout with 3 icon+label tabs.
 * - Preview tab for diagram/document preview
 * - Chat tab for chat panel
 * - Terminal tab for terminal access
 *
 * Handles touch target sizing (44x44px minimum) and safe area padding for iOS.
 */

import React from 'react';

export type MobileTab = 'preview' | 'chat' | 'terminal';

export interface BottomTabBarProps {
  /** Currently active tab */
  activeTab: MobileTab;
  /** Callback when tab is tapped */
  onTabChange: (tab: MobileTab) => void;
  /** Optional custom class name */
  className?: string;
}

const TABS = [
  {
    id: 'preview' as const,
    label: 'Preview',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: 'chat' as const,
    label: 'Chat',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'terminal' as const,
    label: 'Terminal',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
];

/**
 * BottomTabBar component
 *
 * Fixed to bottom of viewport, provides touch-friendly navigation between tabs.
 * Safe area padding for devices with home indicators (iOS).
 */
export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  onTabChange,
  className = '',
}) => {
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-stretch ${className}`}
      style={{
        paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
      }}
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 px-1 min-h-[44px] transition-colors ${
            activeTab === tab.id
              ? 'text-blue-600 dark:text-blue-400 font-semibold'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
          }`}
          title={tab.label}
          aria-label={tab.label}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          <div className="flex items-center justify-center h-6 w-6">
            {tab.icon}
          </div>
          <span className="text-xs font-medium">{tab.label}</span>
        </button>
      ))}
    </div>
  );
};

BottomTabBar.displayName = 'BottomTabBar';

export default BottomTabBar;
