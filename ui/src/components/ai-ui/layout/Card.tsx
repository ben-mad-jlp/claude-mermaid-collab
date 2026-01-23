/**
 * Card Component
 *
 * Container component with optional title, subtitle, and footer.
 * Provides a visual container with styling and optional collapsible functionality.
 *
 * Features:
 * - Optional title and subtitle
 * - Optional footer content
 * - Collapsible sections
 * - Customizable border color and background
 * - Elevation/shadow levels
 * - Responsive design
 * - Dark mode support
 */

import React, { useState } from 'react';
import type { CardProps } from '@/types/ai-ui';

export interface CardComponentProps extends CardProps {
  children?: React.ReactNode;
}

/**
 * Get elevation shadow classes
 */
function getElevationClasses(elevation?: number): string {
  switch (elevation) {
    case 1:
      return 'shadow-sm';
    case 2:
      return 'shadow';
    case 3:
      return 'shadow-md';
    case 4:
      return 'shadow-lg';
    case 5:
      return 'shadow-xl';
    default:
      return 'shadow';
  }
}

/**
 * Card component - Container with optional title and collapsible sections
 */
export const Card: React.FC<CardComponentProps> = ({
  title,
  subtitle,
  footer,
  collapsible = false,
  collapsed: initialCollapsed = false,
  borderColor,
  backgroundColor,
  elevation,
  className = '',
  hidden = false,
  children,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  if (hidden) {
    return null;
  }

  // Tailwind doesn't support dynamic class names, so use inline styles for custom colors
  const customBorderStyle = borderColor ? { borderColor: borderColor } : {};
  const customBgStyle = backgroundColor ? { backgroundColor: backgroundColor } : {};
  const customStyle = { ...customBorderStyle, ...customBgStyle };

  const elevationClass = getElevationClasses(elevation);

  return (
    <div
      className={`
        ${elevation ? `rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 ${elevationClass}` : ''}
        transition-all
        ${className}
      `}
      style={customStyle}
      role="region"
      aria-label={title}
    >
      {/* Card Header */}
      {(title || subtitle) && (
        <div className={`${elevation ? 'border-b border-gray-200 dark:border-gray-700 px-4 py-2' : 'pb-2'}`}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              {title && (
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>

            {/* Collapse Button */}
            {collapsible && (
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className={`
                  ml-2
                  flex-shrink-0
                  p-1
                  rounded
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  text-gray-600 dark:text-gray-400
                  hover:text-gray-900 dark:hover:text-white
                  transition-colors
                `}
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              >
                <svg
                  className={`w-4 h-4 transition-transform ${
                    isCollapsed ? '-rotate-90' : ''
                  }`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Card Content */}
      {!isCollapsed && (
        <div className={elevation ? 'px-4 py-3' : 'py-1'}>
          {children}
        </div>
      )}

      {/* Card Footer */}
      {footer && !isCollapsed && (
        <div className={`${elevation ? 'border-t border-gray-200 dark:border-gray-700 px-4 py-2 bg-gray-50 dark:bg-gray-900/50' : 'pt-2'}`}>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {footer}
          </p>
        </div>
      )}
    </div>
  );
};

export default Card;
