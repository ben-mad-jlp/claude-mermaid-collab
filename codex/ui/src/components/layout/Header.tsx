/**
 * Header Component
 *
 * Page header for the Codex dashboard.
 * Displays page title, optional breadcrumbs, and action buttons.
 */

import React from 'react';

/**
 * Breadcrumb item definition
 */
export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface HeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle or description */
  subtitle?: string;
  /** Breadcrumb navigation items */
  breadcrumbs?: BreadcrumbItem[];
  /** Action buttons slot */
  actions?: React.ReactNode;
  /** Optional additional class name */
  className?: string;
}

/**
 * Header component - Page title with breadcrumbs and actions
 */
export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  breadcrumbs,
  actions,
  className = '',
}) => {
  return (
    <header
      className={`
        px-6 py-4
        bg-white dark:bg-gray-800
        border-b border-gray-200 dark:border-gray-700
        ${className}
      `}
    >
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-2" aria-label="Breadcrumb">
          <ol className="flex items-center space-x-2 text-sm">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <li key={index} className="flex items-center">
                  {index > 0 && (
                    <svg
                      className="w-4 h-4 mx-2 text-gray-400 dark:text-gray-500"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  {crumb.href && !isLast ? (
                    <a
                      href={crumb.href}
                      className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    >
                      {crumb.label}
                    </a>
                  ) : (
                    <span
                      className={
                        isLast
                          ? 'text-gray-900 dark:text-white font-medium'
                          : 'text-gray-500 dark:text-gray-400'
                      }
                      aria-current={isLast ? 'page' : undefined}
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {/* Title and Actions Row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        {actions && (
          <div className="flex items-center gap-3">{actions}</div>
        )}
      </div>
    </header>
  );
};

export default Header;
