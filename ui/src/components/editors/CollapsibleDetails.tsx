/**
 * CollapsibleDetails Component
 *
 * React component for rendering HTML <details>/<summary> elements with:
 * - Smooth CSS transitions for expand/collapse
 * - Chevron icon with rotation animation
 * - Theme-aware styling (light/dark mode)
 * - ARIA accessibility attributes
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface CollapsibleDetailsProps {
  children?: React.ReactNode;
  open?: boolean;
  className?: string;
}

interface CollapsibleSummaryProps {
  children?: React.ReactNode;
  className?: string;
}

/**
 * Chevron icon component
 */
const ChevronIcon: React.FC<{ isOpen: boolean }> = ({ isOpen }) => (
  <svg
    className={`w-4 h-4 transition-transform duration-200 ${
      isOpen ? 'rotate-90' : ''
    }`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 5l7 7-7 7"
    />
  </svg>
);

/**
 * Summary component for use inside CollapsibleDetails
 */
export const CollapsibleSummary: React.FC<CollapsibleSummaryProps> = ({
  children,
}) => {
  return <>{children}</>;
};

CollapsibleSummary.displayName = 'CollapsibleSummary';

/**
 * CollapsibleDetails component with smooth animations
 */
export const CollapsibleDetails: React.FC<CollapsibleDetailsProps> = ({
  children,
  open: initialOpen = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [measuredHeight, setMeasuredHeight] = useState<number>(0);
  const [transitioning, setTransitioning] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    setTransitioning(true);
    setIsOpen((prev) => !prev);
  };

  const updateHeight = useCallback(() => {
    if (contentRef.current) {
      setMeasuredHeight(contentRef.current.scrollHeight);
    }
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateHeight]);

  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.target === e.currentTarget) {
      setTransitioning(false);
    }
  }, []);

  // Extract summary and content from children
  let summaryContent: React.ReactNode = 'Details';
  const contentChildren: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (
        child.type === 'summary' ||
        child.type === CollapsibleSummary ||
        (typeof child.type === 'string' && child.type === 'summary')
      ) {
        summaryContent = child.props.children;
      } else {
        contentChildren.push(child);
      }
    } else if (child !== null && child !== undefined) {
      contentChildren.push(child);
    }
  });

  return (
    <div
      className={`collapsible-details my-3 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden ${className}`}
      data-testid="collapsible-details"
    >
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors duration-150 cursor-pointer"
        aria-expanded={isOpen}
        data-testid="collapsible-summary"
      >
        <ChevronIcon isOpen={isOpen} />
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {summaryContent}
        </span>
      </button>
      <div
        ref={contentRef}
        className={`${isOpen && !transitioning ? 'overflow-visible' : 'overflow-hidden'} transition-[max-height] duration-300 ease-in-out`}
        style={{
          maxHeight: isOpen ? (measuredHeight || 'none') : 0,
        }}
        onTransitionEnd={handleTransitionEnd}
        data-testid="collapsible-content"
      >
        <div className="px-4 py-3">
          {contentChildren}
        </div>
      </div>
    </div>
  );
};

export default CollapsibleDetails;
