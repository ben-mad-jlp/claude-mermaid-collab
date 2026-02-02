/**
 * SplitPane Component
 *
 * Resizable split pane layout using react-resizable-panels with:
 * - Horizontal or vertical split direction
 * - Customizable minimum and default sizes
 * - Persistent split position
 * - Collapse/expand functionality
 * - Tailwind CSS styling
 *
 * Integrates with useUIStore for persisting split positions.
 */

import React, { useCallback, useRef } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  ImperativePanelHandle,
} from 'react-resizable-panels';

export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitPaneProps {
  /** Primary panel content (left or top) */
  primaryContent: React.ReactNode;
  /** Secondary panel content (right or bottom) */
  secondaryContent: React.ReactNode;
  /** Split direction */
  direction?: SplitDirection;
  /** Default size of primary panel (percentage) */
  defaultPrimarySize?: number;
  /** Minimum size of primary panel (percentage) */
  minPrimarySize?: number;
  /** Maximum size of primary panel (percentage) */
  maxPrimarySize?: number;
  /** Minimum size of secondary panel (percentage) */
  minSecondarySize?: number;
  /** Whether primary panel is collapsible */
  primaryCollapsible?: boolean;
  /** Whether secondary panel is collapsible */
  secondaryCollapsible?: boolean;
  /** Callback when primary panel is collapsed */
  onPrimaryCollapse?: () => void;
  /** Callback when primary panel is expanded */
  onPrimaryExpand?: () => void;
  /** Callback when size changes */
  onSizeChange?: (primarySize: number) => void;
  /** Unique ID for persisting layout */
  storageId?: string;
  /** Optional custom class name */
  className?: string;
  /** Custom resize handle content */
  resizeHandleContent?: React.ReactNode;
}

/**
 * Resizable split pane component with drag handle
 */
export const SplitPane: React.FC<SplitPaneProps> = ({
  primaryContent,
  secondaryContent,
  direction = 'horizontal',
  defaultPrimarySize = 50,
  minPrimarySize = 10,
  maxPrimarySize = 90,
  minSecondarySize = 10,
  primaryCollapsible = false,
  secondaryCollapsible = false,
  onPrimaryCollapse,
  onPrimaryExpand,
  onSizeChange,
  storageId,
  className = '',
  resizeHandleContent,
}) => {
  const primaryPanelRef = useRef<ImperativePanelHandle>(null);
  const previousCollapsedRef = useRef<boolean>(false);

  // Handle layout changes - MixedSizes has sizePercentage and sizePixels properties
  const handleLayout = useCallback(
    (sizes: Array<{ sizePercentage: number; sizePixels: number }>) => {
      const primarySize = sizes[0]?.sizePercentage ?? 0;
      onSizeChange?.(primarySize);

      // Check for collapse/expand events
      const isCollapsed = primarySize <= 0;
      if (isCollapsed !== previousCollapsedRef.current) {
        previousCollapsedRef.current = isCollapsed;
        if (isCollapsed) {
          onPrimaryCollapse?.();
        } else {
          onPrimaryExpand?.();
        }
      }
    },
    [onSizeChange, onPrimaryCollapse, onPrimaryExpand]
  );

  // Collapse primary panel
  const collapsePrimary = useCallback(() => {
    primaryPanelRef.current?.collapse();
  }, []);

  // Expand primary panel
  const expandPrimary = useCallback(() => {
    primaryPanelRef.current?.expand();
  }, []);

  return (
    <div
      data-testid="split-pane"
      className={`w-full h-full ${className}`}
    >
      <PanelGroup
        direction={direction}
        onLayout={handleLayout}
        autoSaveId={storageId}
      >
        {/* Primary Panel */}
        <Panel
          ref={primaryPanelRef}
          defaultSizePercentage={defaultPrimarySize}
          minSizePercentage={minPrimarySize}
          maxSizePercentage={maxPrimarySize}
          collapsible={primaryCollapsible}
          collapsedSizePercentage={0}
          onCollapse={onPrimaryCollapse}
          onExpand={onPrimaryExpand}
          data-testid="split-pane-primary"
        >
          <div className="w-full h-full overflow-hidden">
            {primaryContent}
          </div>
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle
          data-testid="split-pane-handle"
          className={`
            group
            ${direction === 'horizontal' ? 'w-1.5' : 'h-1.5'}
            bg-gray-200 dark:bg-gray-700
            hover:bg-accent-400 dark:hover:bg-accent-600
            active:bg-accent-500 dark:active:bg-accent-500
            flex items-center justify-center
          `}
        >
          {resizeHandleContent || (
            <div
              className={`
                ${direction === 'horizontal' ? 'h-8 w-0.5' : 'w-8 h-0.5'}
                bg-gray-400 dark:bg-gray-500
                group-hover:bg-white dark:group-hover:bg-white
                rounded-full
                opacity-0 group-hover:opacity-100
                transition-opacity
              `}
            />
          )}
        </PanelResizeHandle>

        {/* Secondary Panel */}
        <Panel
          minSizePercentage={minSecondarySize}
          collapsible={secondaryCollapsible}
          data-testid="split-pane-secondary"
        >
          <div className="w-full h-full overflow-hidden">
            {secondaryContent}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
};

/**
 * Three-way split pane for more complex layouts
 */
export interface ThreeWaySplitPaneProps {
  /** Left/top panel content */
  leftContent: React.ReactNode;
  /** Center panel content */
  centerContent: React.ReactNode;
  /** Right/bottom panel content */
  rightContent: React.ReactNode;
  /** Split direction */
  direction?: SplitDirection;
  /** Default sizes [left, center, right] as percentages */
  defaultSizes?: [number, number, number];
  /** Minimum size for left panel */
  minLeftSize?: number;
  /** Minimum size for center panel */
  minCenterSize?: number;
  /** Minimum size for right panel */
  minRightSize?: number;
  /** Whether left panel is collapsible */
  leftCollapsible?: boolean;
  /** Whether right panel is collapsible */
  rightCollapsible?: boolean;
  /** Unique ID for persisting layout */
  storageId?: string;
  /** Optional custom class name */
  className?: string;
}

/**
 * Three-way split pane component
 */
export const ThreeWaySplitPane: React.FC<ThreeWaySplitPaneProps> = ({
  leftContent,
  centerContent,
  rightContent,
  direction = 'horizontal',
  defaultSizes = [20, 60, 20],
  minLeftSize = 10,
  minCenterSize = 30,
  minRightSize = 10,
  leftCollapsible = false,
  rightCollapsible = false,
  storageId,
  className = '',
}) => {
  return (
    <div
      data-testid="three-way-split-pane"
      className={`w-full h-full ${className}`}
    >
      <PanelGroup
        direction={direction}
        autoSaveId={storageId}
      >
        {/* Left Panel */}
        <Panel
          defaultSizePercentage={defaultSizes[0]}
          minSizePercentage={minLeftSize}
          collapsible={leftCollapsible}
          collapsedSizePercentage={0}
          data-testid="split-pane-left"
        >
          <div className="w-full h-full overflow-hidden">
            {leftContent}
          </div>
        </Panel>

        {/* Left Resize Handle */}
        <PanelResizeHandle
          data-testid="split-pane-handle-left"
          className={`
            group
            ${direction === 'horizontal' ? 'w-1.5' : 'h-1.5'}
            bg-gray-200 dark:bg-gray-700
            hover:bg-accent-400 dark:hover:bg-accent-600
            active:bg-accent-500 dark:active:bg-accent-500
            flex items-center justify-center
          `}
        >
          <div
            className={`
              ${direction === 'horizontal' ? 'h-8 w-0.5' : 'w-8 h-0.5'}
              bg-gray-400 dark:bg-gray-500
              group-hover:bg-white dark:group-hover:bg-white
              rounded-full
              opacity-0 group-hover:opacity-100
              transition-opacity
            `}
          />
        </PanelResizeHandle>

        {/* Center Panel */}
        <Panel
          defaultSizePercentage={defaultSizes[1]}
          minSizePercentage={minCenterSize}
          data-testid="split-pane-center"
        >
          <div className="w-full h-full overflow-hidden">
            {centerContent}
          </div>
        </Panel>

        {/* Right Resize Handle */}
        <PanelResizeHandle
          data-testid="split-pane-handle-right"
          className={`
            group
            ${direction === 'horizontal' ? 'w-1.5' : 'h-1.5'}
            bg-gray-200 dark:bg-gray-700
            hover:bg-accent-400 dark:hover:bg-accent-600
            active:bg-accent-500 dark:active:bg-accent-500
            flex items-center justify-center
          `}
        >
          <div
            className={`
              ${direction === 'horizontal' ? 'h-8 w-0.5' : 'w-8 h-0.5'}
              bg-gray-400 dark:bg-gray-500
              group-hover:bg-white dark:group-hover:bg-white
              rounded-full
              opacity-0 group-hover:opacity-100
              transition-opacity
            `}
          />
        </PanelResizeHandle>

        {/* Right Panel */}
        <Panel
          defaultSizePercentage={defaultSizes[2]}
          minSizePercentage={minRightSize}
          collapsible={rightCollapsible}
          collapsedSizePercentage={0}
          data-testid="split-pane-right"
        >
          <div className="w-full h-full overflow-hidden">
            {rightContent}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
};

export default SplitPane;
