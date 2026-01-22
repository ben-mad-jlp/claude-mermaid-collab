/**
 * Accordion Component
 *
 * Collapsible sections with expand/collapse capability.
 * Supports single or multiple open sections.
 *
 * Features:
 * - Multiple expand/collapse sections
 * - Allow multiple sections open simultaneously (configurable)
 * - Different styling variants (default, flush, outlined)
 * - Smooth transitions
 * - Dark mode support
 * - Keyboard accessible
 */

import React, { useState } from 'react';
import type { AccordionProps, UIComponent } from '@types/ai-ui';

export interface AccordionComponentProps extends AccordionProps {
  children?: React.ReactNode;
}

/**
 * Get variant classes based on variant type
 */
function getVariantClasses(variant: string = 'default'): {
  container: string;
  section: string;
  header: string;
  content: string;
} {
  switch (variant) {
    case 'flush':
      return {
        container: 'space-y-0 divide-y divide-gray-200 dark:divide-gray-700',
        section: 'rounded-none',
        header:
          'px-0 py-4 border-0 border-b border-gray-200 dark:border-gray-700',
        content: 'px-0 py-4',
      };
    case 'outlined':
      return {
        container: 'space-y-3 divide-y-0',
        section:
          'border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden',
        header: 'border-0',
        content: 'px-6 py-4 bg-gray-50 dark:bg-gray-900/50',
      };
    default:
      return {
        container: 'space-y-3 divide-y-0',
        section: 'border border-gray-200 dark:border-gray-700 rounded-lg',
        header:
          'border-b border-gray-200 dark:border-gray-700 px-6 py-4 bg-gray-50 dark:bg-gray-900/50',
        content: 'px-6 py-4',
      };
  }
}

/**
 * Accordion component - Collapsible sections
 */
export const Accordion: React.FC<AccordionComponentProps> = ({
  sections = [],
  allowMultiple = false,
  variant = 'default',
  className = '',
  hidden = false,
}) => {
  const [expandedIds, setExpandedIds] = useState<string[]>(
    sections.filter((s) => s.expanded).map((s) => s.id)
  );

  if (hidden || sections.length === 0) {
    return null;
  }

  const handleToggle = (id: string) => {
    setExpandedIds((prev) => {
      if (allowMultiple) {
        return prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id];
      } else {
        return prev.includes(id) ? [] : [id];
      }
    });
  };

  const variantClasses = getVariantClasses(variant);

  return (
    <div
      className={`
        ${variantClasses.container}
        ${className}
      `}
      role="region"
      aria-label="Accordion"
    >
      {sections.map((section) => {
        const isExpanded = expandedIds.includes(section.id);

        return (
          <div
            key={section.id}
            className={`
              transition-all
              ${variantClasses.section}
            `}
          >
            {/* Header */}
            <button
              onClick={() => handleToggle(section.id)}
              className={`
                w-full
                flex items-center justify-between
                text-left
                font-medium
                text-gray-900 dark:text-white
                hover:bg-gray-100 dark:hover:bg-gray-800
                transition-colors
                ${variantClasses.header}
              `}
              aria-expanded={isExpanded}
              aria-controls={`accordion-content-${section.id}`}
            >
              <span className="font-semibold">{section.title}</span>
              <svg
                className={`
                  w-5 h-5
                  flex-shrink-0
                  text-gray-600 dark:text-gray-400
                  transition-transform
                  ${isExpanded ? '' : '-rotate-90'}
                `}
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

            {/* Content */}
            {isExpanded && (
              <div
                id={`accordion-content-${section.id}`}
                className={`
                  border-t border-gray-200 dark:border-gray-700
                  ${variantClasses.content}
                `}
              >
                {section.content ? (
                  <AccordionContent content={section.content} />
                ) : (
                  <p className="text-gray-600 dark:text-gray-400">
                    No content available
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Helper component to render accordion content
 */
const AccordionContent: React.FC<{ content: UIComponent }> = ({ content }) => {
  // For now, render text content
  // In a full implementation, this would recursively render UI components
  if (typeof content === 'string') {
    return <p className="text-gray-700 dark:text-gray-300">{content}</p>;
  }

  if (content && typeof content === 'object' && 'props' in content) {
    const props = (content as any).props;
    if (props.content) {
      return (
        <div className="text-gray-700 dark:text-gray-300">
          {props.content}
        </div>
      );
    }
  }

  return <div className="text-gray-700 dark:text-gray-300">{content}</div>;
};

export default Accordion;
