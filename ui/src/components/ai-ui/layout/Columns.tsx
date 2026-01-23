/**
 * Columns Component
 *
 * Multi-column layout with responsive support.
 * Automatically adjusts columns based on screen size.
 *
 * Features:
 * - Configurable number of columns
 * - Customizable gap between columns
 * - Responsive breakpoints
 * - Flexible item alignment
 * - Dark mode support
 */

import React from 'react';
import type { ColumnsProps } from '@/types/ai-ui';

export interface ColumnsComponentProps extends ColumnsProps {
  children?: React.ReactNode;
}

/**
 * Get gap classes based on gap value
 */
function getGapClasses(gap?: number): string {
  switch (gap) {
    case 1:
      return 'gap-1';
    case 2:
      return 'gap-2';
    case 3:
      return 'gap-3';
    case 4:
      return 'gap-4';
    case 6:
      return 'gap-6';
    case 8:
      return 'gap-8';
    default:
      return 'gap-4';
  }
}

/**
 * Get alignment classes based on alignItems value
 */
function getAlignmentClasses(align?: string): string {
  switch (align) {
    case 'start':
      return 'items-start';
    case 'center':
      return 'items-center';
    case 'end':
      return 'items-end';
    case 'stretch':
      return 'items-stretch';
    default:
      return 'items-stretch';
  }
}

/**
 * Get grid column classes based on columns value
 */
function getColumnClasses(columns: number, responsive: boolean = false): string {
  let gridClass = `grid-cols-${columns}`;

  if (responsive) {
    // Responsive grid classes: mobile first, then tablet/desktop
    if (columns === 1) return 'grid-cols-1';
    if (columns === 2) return 'grid-cols-1 sm:grid-cols-2';
    if (columns === 3) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
    if (columns === 4) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
    if (columns >= 5) return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5';
  }

  return gridClass;
}

/**
 * Columns component - Multi-column layout with responsive support
 */
export const Columns: React.FC<ColumnsComponentProps> = ({
  columns,
  gap,
  responsive = true,
  breakpoints,
  alignItems = 'stretch',
  className = '',
  hidden = false,
  children,
}) => {
  if (hidden) {
    return null;
  }

  const gapClasses = getGapClasses(gap);
  const alignmentClasses = getAlignmentClasses(alignItems);
  const columnClasses = getColumnClasses(columns, responsive);

  // Validate that we have at least one child
  const childArray = React.Children.toArray(children);

  return (
    <div
      className={`
        grid
        ${columnClasses}
        ${gapClasses}
        ${alignmentClasses}
        ${className}
      `}
      role="region"
      aria-label={`${columns} column layout`}
    >
      {childArray.map((child, index) => (
        <div key={index} className="flex flex-col">
          {child}
        </div>
      ))}
    </div>
  );
};

export default Columns;
