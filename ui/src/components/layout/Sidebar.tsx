/**
 * Sidebar Component
 *
 * Left sidebar with:
 * - Navigation items with icons
 * - Collapsible functionality
 * - Active state indication
 *
 * Integrates with useUIStore for sidebar visibility state.
 */

import React, { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';

export interface NavItem {
  /** Unique identifier for the nav item */
  id: string;
  /** Display label */
  label: string;
  /** Icon component or element */
  icon?: React.ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Whether this item is currently active */
  isActive?: boolean;
  /** Badge count to display */
  badge?: number;
}

export interface SidebarProps {
  /** Navigation items to display */
  items?: NavItem[];
  /** Currently active item id */
  activeItemId?: string;
  /** Callback when an item is clicked */
  onItemClick?: (item: NavItem) => void;
  /** Optional custom class name */
  className?: string;
}

/**
 * Collapsible sidebar component with navigation items
 */
export const Sidebar: React.FC<SidebarProps> = ({
  items = [],
  activeItemId,
  onItemClick,
  className = '',
}) => {
  const { sidebarVisible, toggleSidebar } = useUIStore(
    useShallow((state) => ({
      sidebarVisible: state.sidebarVisible,
      toggleSidebar: state.toggleSidebar,
    }))
  );

  const handleItemClick = useCallback(
    (item: NavItem) => {
      item.onClick?.();
      onItemClick?.(item);
    },
    [onItemClick]
  );

  const handleToggle = useCallback(() => {
    toggleSidebar();
  }, [toggleSidebar]);

  return (
    <aside
      data-testid="sidebar"
      className={`
        flex flex-col
        bg-gray-50 dark:bg-gray-900
        border-r border-gray-200 dark:border-gray-700
        transition-all duration-200
        ${sidebarVisible ? 'w-56' : 'w-14'}
        ${className}
      `.trim()}
    >
      {/* Toggle Button */}
      <div className="flex items-center justify-end p-2 border-b border-gray-200 dark:border-gray-700">
        <button
          data-testid="sidebar-toggle"
          onClick={handleToggle}
          aria-label={sidebarVisible ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={sidebarVisible}
          className="
            p-1.5
            text-gray-500 dark:text-gray-400
            hover:text-gray-700 dark:hover:text-gray-200
            hover:bg-gray-200 dark:hover:bg-gray-700
            rounded
            transition-colors
          "
        >
          <svg
            className={`w-5 h-5 transition-transform ${sidebarVisible ? '' : 'rotate-180'}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 py-2 overflow-y-auto" role="navigation" aria-label="Sidebar navigation">
        {items.length === 0 ? (
          <div
            data-testid="sidebar-empty"
            className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400"
          >
            {sidebarVisible && 'No items'}
          </div>
        ) : (
          <ul className="space-y-1 px-2">
            {items.map((item) => {
              const isActive = item.isActive || item.id === activeItemId;
              return (
                <li key={item.id}>
                  <button
                    data-testid={`sidebar-item-${item.id}`}
                    onClick={() => handleItemClick(item)}
                    title={!sidebarVisible ? item.label : undefined}
                    className={`
                      w-full flex items-center gap-3
                      px-3 py-2
                      text-sm font-medium
                      rounded-lg
                      transition-colors
                      ${
                        isActive
                          ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }
                    `}
                  >
                    {/* Icon */}
                    {item.icon && (
                      <span
                        className={`flex-shrink-0 w-5 h-5 ${
                          isActive
                            ? 'text-accent-600 dark:text-accent-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {item.icon}
                      </span>
                    )}

                    {/* Label */}
                    {sidebarVisible && (
                      <span className="flex-1 truncate text-left">{item.label}</span>
                    )}

                    {/* Badge */}
                    {sidebarVisible && item.badge !== undefined && item.badge > 0 && (
                      <span
                        className={`
                          flex-shrink-0
                          px-1.5 py-0.5
                          text-xs font-semibold
                          rounded-full
                          ${
                            isActive
                              ? 'bg-accent-200 dark:bg-accent-800 text-accent-800 dark:text-accent-200'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                          }
                        `}
                      >
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* Collapsed Badge Indicator */}
      {!sidebarVisible && items.some((item) => item.badge && item.badge > 0) && (
        <div className="px-2 py-3 border-t border-gray-200 dark:border-gray-700">
          <div
            className="
              w-2 h-2 mx-auto
              bg-accent-500
              rounded-full
            "
            aria-label="Items have notifications"
          />
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
