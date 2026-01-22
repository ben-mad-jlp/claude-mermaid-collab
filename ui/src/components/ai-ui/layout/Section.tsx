/**
 * Section Component
 *
 * Logical grouping container with heading and optional description.
 * Used for organizing content with semantic structure.
 *
 * Features:
 * - Configurable heading level (h1-h6)
 * - Optional description
 * - Optional divider
 * - Collapsible sections
 * - Responsive spacing
 * - Dark mode support
 */

import React, { useState } from 'react';
import type { SectionProps } from '@types/ai-ui';

export interface SectionComponentProps extends SectionProps {
  children?: React.ReactNode;
}

/**
 * Get heading tag based on level
 */
function getHeadingTag(level: number = 2): React.ElementType {
  const tag = `h${Math.min(Math.max(level, 1), 6)}` as keyof JSX.IntrinsicElements;
  return tag as any;
}

/**
 * Get heading size classes based on level
 */
function getHeadingSizeClasses(level: number = 2): string {
  switch (level) {
    case 1:
      return 'text-3xl font-bold';
    case 2:
      return 'text-2xl font-bold';
    case 3:
      return 'text-xl font-semibold';
    case 4:
      return 'text-lg font-semibold';
    case 5:
      return 'text-base font-semibold';
    case 6:
      return 'text-sm font-semibold';
    default:
      return 'text-xl font-semibold';
  }
}

/**
 * Section component - Logical grouping with heading and description
 */
export const Section: React.FC<SectionComponentProps> = ({
  heading,
  description,
  level = 2,
  divider = false,
  collapsible = false,
  collapsed: initialCollapsed = false,
  className = '',
  hidden = false,
  children,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  if (hidden) {
    return null;
  }

  const HeadingTag = getHeadingTag(level);
  const headingSizeClasses = getHeadingSizeClasses(level);

  return (
    <section
      className={`
        space-y-4
        ${className}
      `}
    >
      {/* Section Header */}
      {heading && (
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <HeadingTag
              className={`
                ${headingSizeClasses}
                text-gray-900 dark:text-white
                truncate
              `}
            >
              {heading}
            </HeadingTag>

            {description && (
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                {description}
              </p>
            )}
          </div>

          {/* Collapse Button */}
          {collapsible && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={`
                ml-4
                flex-shrink-0
                p-2
                rounded-lg
                hover:bg-gray-100 dark:hover:bg-gray-700
                text-gray-600 dark:text-gray-400
                hover:text-gray-900 dark:hover:text-white
                transition-colors
              `}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
            >
              <svg
                className={`w-5 h-5 transition-transform ${
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
      )}

      {/* Divider */}
      {divider && (
        <div className="border-t border-gray-200 dark:border-gray-700" />
      )}

      {/* Section Content */}
      {!isCollapsed && (
        <div className="space-y-4">
          {children}
        </div>
      )}
    </section>
  );
};

export default Section;
