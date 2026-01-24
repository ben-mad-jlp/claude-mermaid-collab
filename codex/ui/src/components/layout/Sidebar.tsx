/**
 * Sidebar Component
 *
 * Navigation sidebar for the Codex dashboard.
 * Displays navigation links with active state highlighting.
 */

import React from 'react';
import type { NavItem } from '../../types';

/**
 * Navigation items for the sidebar
 */
const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: 'dashboard' },
  { label: 'Topics', href: '/topics', icon: 'topics' },
  { label: 'Flags', href: '/flags', icon: 'flags' },
  { label: 'Missing', href: '/missing', icon: 'missing' },
];

export interface SidebarProps {
  /** Currently active path for highlighting */
  activePath?: string;
  /** Optional additional class name */
  className?: string;
}

/**
 * Get icon SVG for navigation item
 */
function NavIcon({ icon, className }: { icon: string; className?: string }) {
  const iconClass = className || 'w-5 h-5';

  switch (icon) {
    case 'dashboard':
      return (
        <svg
          className={iconClass}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
        </svg>
      );
    case 'topics':
      return (
        <svg
          className={iconClass}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
        </svg>
      );
    case 'flags':
      return (
        <svg
          className={iconClass}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"
            clipRule="evenodd"
          />
        </svg>
      );
    case 'missing':
      return (
        <svg
          className={iconClass}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      );
    default:
      return (
        <svg
          className={iconClass}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
            clipRule="evenodd"
          />
        </svg>
      );
  }
}

/**
 * Sidebar component - Navigation with active state highlighting
 */
export const Sidebar: React.FC<SidebarProps> = ({
  activePath = '/',
  className = '',
}) => {
  return (
    <aside
      className={`
        w-64
        flex flex-col
        bg-white dark:bg-gray-800
        border-r border-gray-200 dark:border-gray-700
        ${className}
      `}
    >
      {/* Logo/Title */}
      <div className="px-4 py-5 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          Collab Codex
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Knowledge Base
        </p>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = activePath === item.href;
          return (
            <a
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3
                px-3 py-2
                rounded-md
                text-sm font-medium
                transition-colors
                ${
                  isActive
                    ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }
              `}
              aria-current={isActive ? 'page' : undefined}
            >
              <NavIcon
                icon={item.icon}
                className={`
                  w-5 h-5
                  ${
                    isActive
                      ? 'text-accent-600 dark:text-accent-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }
                `}
              />
              {item.label}
            </a>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Collab Codex v1.0
        </p>
      </div>
    </aside>
  );
};

export default Sidebar;
