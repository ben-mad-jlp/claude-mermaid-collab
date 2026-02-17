/**
 * CollapsibleSection Component
 *
 * Renders a markdown section with a collapsible heading.
 * Used to make heading-based sections expandable/collapsible.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface CollapsibleSectionProps {
  /** Heading level (1-6) */
  level: number;
  /** Heading text content */
  title: React.ReactNode;
  /** Section content */
  children: React.ReactNode;
  /** Whether section is expanded */
  isExpanded?: boolean;
  /** Callback when toggle is clicked */
  onToggle?: () => void;
  /** Section ID for tracking */
  sectionId: string;
}

const headingClasses: Record<number, string> = {
  1: 'text-3xl font-bold mt-6 mb-4 text-gray-900 dark:text-white',
  2: 'text-2xl font-bold mt-5 mb-3 text-gray-800 dark:text-gray-100',
  3: 'text-xl font-bold mt-4 mb-2 text-gray-700 dark:text-gray-200',
  4: 'text-lg font-bold mt-3 mb-2 text-gray-700 dark:text-gray-200',
  5: 'text-base font-bold mt-2 mb-1 text-gray-700 dark:text-gray-200',
  6: 'text-sm font-bold mt-2 mb-1 text-gray-700 dark:text-gray-200',
};

/**
 * Chevron icon that rotates based on expanded state
 */
const ChevronIcon: React.FC<{ isExpanded: boolean }> = ({ isExpanded }) => (
  <svg
    className={`w-4 h-4 transition-transform duration-200 flex-shrink-0 ${
      isExpanded ? 'rotate-90' : ''
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
 * A collapsible section with a heading that can be expanded/collapsed
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  level,
  title,
  children,
  isExpanded = true,
  onToggle,
  sectionId,
}) => {
  const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
  const headingClass = headingClasses[level] || headingClasses[6];
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(0);
  const [transitioning, setTransitioning] = useState(false);

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

  useEffect(() => {
    setTransitioning(true);
  }, [isExpanded]);

  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.target === e.currentTarget) {
      setTransitioning(false);
    }
  }, []);

  return (
    <div className="collapsible-section" data-section-id={sectionId}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity ${headingClass}`}
        aria-expanded={isExpanded}
        aria-controls={`section-content-${sectionId}`}
      >
        <ChevronIcon isExpanded={isExpanded} />
        <HeadingTag className="inline m-0">{title}</HeadingTag>
      </button>
      <div
        ref={contentRef}
        id={`section-content-${sectionId}`}
        className={`${isExpanded && !transitioning ? 'overflow-visible' : 'overflow-hidden'} transition-all duration-300 ease-in-out`}
        style={{
          maxHeight: isExpanded ? (measuredHeight || 'none') : 0,
          opacity: isExpanded ? 1 : 0,
        }}
        onTransitionEnd={handleTransitionEnd}
      >
        <div className="pl-6">{children}</div>
      </div>
    </div>
  );
};

/**
 * Context for managing all collapsible sections
 */
interface CollapsibleSectionsContextValue {
  expandedSections: Set<string>;
  toggleSection: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  registerSection: (id: string) => void;
  sectionCount: number;
}

const CollapsibleSectionsContext = React.createContext<CollapsibleSectionsContextValue | null>(null);

export const useCollapsibleSections = () => {
  const context = React.useContext(CollapsibleSectionsContext);
  if (!context) {
    throw new Error('useCollapsibleSections must be used within CollapsibleSectionsProvider');
  }
  return context;
};

export const useCollapsibleSectionsSafe = () => {
  return React.useContext(CollapsibleSectionsContext);
};

interface CollapsibleSectionsProviderProps {
  children: React.ReactNode;
}

export const CollapsibleSectionsProvider: React.FC<CollapsibleSectionsProviderProps> = ({
  children,
}) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [allSections, setAllSections] = useState<Set<string>>(new Set());

  const registerSection = React.useCallback((id: string) => {
    setAllSections(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      // Only add to expandedSections for NEW sections (not previously tracked)
      // This prevents re-expanding sections that were manually collapsed
      setExpandedSections(expPrev => {
        const expNext = new Set(expPrev);
        expNext.add(id);
        return expNext;
      });
      return next;
    });
  }, []);

  const toggleSection = React.useCallback((id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandAll = React.useCallback(() => {
    setExpandedSections(new Set(allSections));
  }, [allSections]);

  const collapseAll = React.useCallback(() => {
    setExpandedSections(new Set());
  }, []);

  const value = React.useMemo(() => ({
    expandedSections,
    toggleSection,
    expandAll,
    collapseAll,
    registerSection,
    sectionCount: allSections.size,
  }), [expandedSections, toggleSection, expandAll, collapseAll, registerSection, allSections.size]);

  return (
    <CollapsibleSectionsContext.Provider value={value}>
      {children}
    </CollapsibleSectionsContext.Provider>
  );
};

/**
 * Wrapper component that registers with context and manages its own state
 */
export const ManagedCollapsibleSection: React.FC<Omit<CollapsibleSectionProps, 'isExpanded' | 'onToggle'>> = ({
  sectionId,
  ...props
}) => {
  const context = useCollapsibleSectionsSafe();
  const [localExpanded, setLocalExpanded] = useState(true);
  const registeredRef = React.useRef(false);

  // Register section only once on mount
  useEffect(() => {
    if (context && !registeredRef.current) {
      registeredRef.current = true;
      context.registerSection(sectionId);
    }
  }, [context, sectionId]);

  const isExpanded = context ? context.expandedSections.has(sectionId) : localExpanded;
  const onToggle = context
    ? () => context.toggleSection(sectionId)
    : () => setLocalExpanded(prev => !prev);

  return (
    <CollapsibleSection
      {...props}
      sectionId={sectionId}
      isExpanded={isExpanded}
      onToggle={onToggle}
    />
  );
};

/**
 * Controls component for Expand All / Collapse All
 */
export const CollapsibleSectionsControls: React.FC = () => {
  const context = useCollapsibleSectionsSafe();

  if (!context) {
    return null;
  }

  return (
    <div
      className="flex justify-end gap-2 mb-4"
      data-testid="collapsible-sections-controls"
    >
      <button
        type="button"
        onClick={context.expandAll}
        className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors duration-150"
        data-testid="expand-all-btn"
      >
        Expand All
      </button>
      <button
        type="button"
        onClick={context.collapseAll}
        className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors duration-150"
        data-testid="collapse-all-btn"
      >
        Collapse All
      </button>
    </div>
  );
};

export default CollapsibleSection;
