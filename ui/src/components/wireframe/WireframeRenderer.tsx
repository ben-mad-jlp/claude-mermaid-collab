/**
 * WireframeRenderer - Main component for rendering JSON wireframes
 *
 * Takes a WireframeRoot definition and renders all screens and components
 * using rough.js for hand-drawn styling. Uses the layout calculator for
 * flexbox-style positioning. Renders everything as pure SVG.
 */

import React, { useMemo, useRef, useEffect } from 'react';
import rough from 'roughjs';
import type {
  WireframeRoot,
  WireframeComponent,
  ScreenComponent,
  LayoutBounds,
} from '../../types/wireframe';
import {
  getViewportDimensions,
} from './layout';
import {
  getSimpleComponent,
  getContainerComponent,
  isContainerComponent,
} from './components';
import { ROUGH_OPTIONS, COLORS } from './svg-utils';

/**
 * Props for the WireframeRenderer component
 */
export interface WireframeRendererProps {
  /** The wireframe definition to render */
  wireframe: WireframeRoot;
  /** Optional scale factor for the rendering */
  scale?: number;
  /** Optional className for the container */
  className?: string;
}

/**
 * Props for the ComponentRenderer helper
 */
interface ComponentRendererProps {
  component: WireframeComponent;
  bounds: LayoutBounds;
  renderChildren: (children: WireframeComponent[], bounds: LayoutBounds) => React.ReactNode;
}

/**
 * Constants for screen layout
 */
const SCREEN_GAP = 32;
const SCREEN_PADDING = 16;
const LABEL_SPACE = 32;
const BASE_HEIGHT = 600;
const VIEWPORT_WIDTHS = {
  mobile: 375,
  tablet: 768,
  desktop: 1200,
} as const;

/**
 * Render a single component with its children
 */
function ComponentRenderer({ component, bounds, renderChildren }: ComponentRendererProps): JSX.Element | null {
  const type = component.type.toLowerCase();

  // Try to get as container first
  if (isContainerComponent(type)) {
    const ContainerComp = getContainerComponent(type);
    if (ContainerComp) {
      return (
        <ContainerComp
          component={component as any}
          bounds={bounds}
          renderChildren={renderChildren}
        />
      );
    }
  }

  // Try as simple component
  const SimpleComp = getSimpleComponent(type);
  if (SimpleComp) {
    return <SimpleComp component={component as any} bounds={bounds} />;
  }

  // Unknown component type - render placeholder
  return (
    <g data-component-type="unknown">
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="#f5f5f5"
        stroke="#999"
        strokeDasharray="4 2"
      />
      <text
        x={bounds.x + bounds.width / 2}
        y={bounds.y + bounds.height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={12}
        fill="#666"
      >
        Unknown: {component.type}
      </text>
    </g>
  );
}

/**
 * Recursive component tree renderer
 * Walks the component tree and renders each component with calculated bounds
 */
function renderComponentTree(
  component: WireframeComponent,
  bounds: LayoutBounds,
  parentBounds: LayoutBounds
): React.ReactNode {
  // Create the renderChildren callback for containers
  const renderChildren = (children: WireframeComponent[], containerBounds: LayoutBounds): React.ReactNode => {
    // Guard against undefined or empty children
    if (!children || children.length === 0) {
      return null;
    }

    // Calculate layout for children using flex algorithm
    // NOTE: Padding is already applied by the Container component (ColRenderer/RowRenderer/CardRenderer)
    // So containerBounds already has padding applied - we just use it directly
    const isRow = component.type === 'row';
    const gap = (component as any).gap ?? 0;

    // Use containerBounds directly - padding already applied by Container
    const contentBounds = containerBounds;

    const totalGaps = gap * (children.length - 1);
    const mainAxisTotal = isRow
      ? contentBounds.width - totalGaps
      : contentBounds.height - totalGaps;

    // Pass 1: Calculate fixed space and total flex
    let fixedSpace = 0;
    let totalFlex = 0;

    for (const child of children) {
      const flex = (child as any).flex ?? 1;
      if (flex === 0) {
        const size = isRow ? child.bounds.width : child.bounds.height;
        fixedSpace += size > 0 ? size : 0;
      } else {
        totalFlex += flex;
      }
    }

    const flexSpace = Math.max(0, mainAxisTotal - fixedSpace);
    const spacePerFlex = totalFlex > 0 ? flexSpace / totalFlex : 0;

    let offset = isRow ? contentBounds.x : contentBounds.y;

    return children.map((child, index) => {
      const flex = (child as any).flex ?? 1;
      const align = (child as any).align || 'start';

      // Calculate main axis size
      let mainSize: number;
      if (flex === 0) {
        mainSize = isRow ? child.bounds.width : child.bounds.height;
        if (mainSize <= 0) mainSize = spacePerFlex; // Fallback
      } else {
        mainSize = spacePerFlex * flex;
      }

      // Calculate cross axis size and position
      const crossAxisTotal = isRow ? contentBounds.height : contentBounds.width;
      let crossSize = isRow ? child.bounds.height : child.bounds.width;
      if (crossSize <= 0) crossSize = crossAxisTotal;

      let crossOffset = 0;
      if (align === 'center') crossOffset = (crossAxisTotal - crossSize) / 2;
      else if (align === 'end') crossOffset = crossAxisTotal - crossSize;

      const childBounds: LayoutBounds = isRow
        ? {
            x: offset,
            y: contentBounds.y + crossOffset,
            width: mainSize,
            height: crossSize,
          }
        : {
            x: contentBounds.x + crossOffset,
            y: offset,
            width: crossSize,
            height: mainSize,
          };

      offset += mainSize + gap;

      return (
        <React.Fragment key={child.id || index}>
          {renderComponentTree(child, childBounds, containerBounds)}
        </React.Fragment>
      );
    });
  };

  return (
    <ComponentRenderer
      key={component.id}
      component={component}
      bounds={bounds}
      renderChildren={renderChildren}
    />
  );
}

/**
 * Screen renderer component - renders a single screen with rough.js border
 */
interface ScreenRendererInternalProps {
  screen: ScreenComponent;
  bounds: LayoutBounds;
  labelY: number;
}

function ScreenRendererInternal({ screen, bounds, labelY }: ScreenRendererInternalProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);

  // Draw rough.js screen border
  useEffect(() => {
    if (!groupRef.current) return;

    const svg = groupRef.current.ownerSVGElement;
    if (!svg) return;

    const rc = rough.svg(svg);

    // Draw screen border with rough.js
    const border = rc.rectangle(
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      {
        ...ROUGH_OPTIONS,
        stroke: COLORS.container.screenBorder,
        fill: 'none',
        strokeWidth: 2,
      }
    );

    groupRef.current.appendChild(border);

    return () => {
      if (border.parentNode === groupRef.current) {
        groupRef.current?.removeChild(border);
      }
    };
  }, [bounds]);

  return (
    <g ref={groupRef} data-screen-id={screen.id}>
      {/* Screen label */}
      <text
        x={bounds.x}
        y={labelY}
        fontSize={14}
        fontWeight="bold"
        fontFamily="sans-serif"
        fill="#374151"
      >
        {screen.name}
      </text>

      {/* Screen background */}
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill={screen.backgroundColor || '#ffffff'}
        rx={4}
        ry={4}
      />

      {/* Render screen children using flex layout */}
      {(() => {
        const children = screen.children;
        const totalGaps = 0; // Screens don't have gap
        const mainAxisTotal = bounds.height - totalGaps;

        // Pass 1: Calculate fixed space and total flex
        let fixedSpace = 0;
        let totalFlex = 0;

        for (const child of children) {
          const flex = (child as any).flex ?? 1;
          if (flex === 0) {
            const size = child.bounds.height;
            fixedSpace += size > 0 ? size : 0;
          } else {
            totalFlex += flex;
          }
        }

        const flexSpace = Math.max(0, mainAxisTotal - fixedSpace);
        const spacePerFlex = totalFlex > 0 ? flexSpace / totalFlex : 0;

        let offset = bounds.y;

        return children.map((child, index) => {
          const flex = (child as any).flex ?? 1;
          const align = (child as any).align || 'start';

          // Calculate main axis size
          let mainSize: number;
          if (flex === 0) {
            mainSize = child.bounds.height;
            if (mainSize <= 0) mainSize = spacePerFlex;
          } else {
            mainSize = spacePerFlex * flex;
          }

          // Calculate cross axis size and position
          const crossAxisTotal = bounds.width;
          let crossSize = child.bounds.width;
          if (crossSize <= 0) crossSize = crossAxisTotal;

          let crossOffset = 0;
          if (align === 'center') crossOffset = (crossAxisTotal - crossSize) / 2;
          else if (align === 'end') crossOffset = crossAxisTotal - crossSize;

          const childBounds: LayoutBounds = {
            x: bounds.x + crossOffset,
            y: offset,
            width: crossSize,
            height: mainSize,
          };

          offset += mainSize;

          return (
            <g key={child.id || index}>
              {renderComponentTree(child, childBounds, bounds)}
            </g>
          );
        });
      })()}
    </g>
  );
}

/**
 * WireframeRenderer - Main component
 *
 * Renders a complete wireframe definition with all screens and components.
 * Uses flexbox-style layout calculation and rough.js for rendering.
 * All rendering is done as pure SVG.
 */
export function WireframeRenderer({
  wireframe,
  scale = 1,
  className,
}: WireframeRendererProps): JSX.Element {
  // Validate wireframe structure - screens array is required
  if (!wireframe?.screens || !Array.isArray(wireframe.screens)) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <p className="mb-2">Invalid wireframe structure</p>
          <p className="text-sm">Missing required "screens" array</p>
        </div>
      </div>
    );
  }

  // Calculate total canvas dimensions
  const dimensions = useMemo(() => {
    return getViewportDimensions(
      wireframe.viewport,
      wireframe.direction,
      wireframe.screens.length
    );
  }, [wireframe.viewport, wireframe.direction, wireframe.screens.length]);

  // Calculate screen positions
  const screenLayouts = useMemo(() => {
    const screenWidth = VIEWPORT_WIDTHS[wireframe.viewport];
    const screenHeight = BASE_HEIGHT;
    const screenWidthWithPadding = screenWidth + SCREEN_PADDING * 2;
    const screenHeightWithPadding = screenHeight + SCREEN_PADDING * 2 + LABEL_SPACE;

    return wireframe.screens.map((screen, index) => {
      const x = wireframe.direction === 'LR'
        ? index * (screenWidthWithPadding + SCREEN_GAP)
        : 0;
      const y = wireframe.direction === 'TD'
        ? index * (screenHeightWithPadding + SCREEN_GAP)
        : 0;

      const bounds: LayoutBounds = {
        x: x + SCREEN_PADDING,
        y: y + SCREEN_PADDING + LABEL_SPACE,
        width: screenWidth,
        height: screenHeight,
      };

      return { screen, bounds, labelY: y + LABEL_SPACE / 2 + 8 };
    });
  }, [wireframe.screens, wireframe.viewport, wireframe.direction]);

  const svgWidth = dimensions.width * scale;
  const svgHeight = dimensions.height * scale;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      width={svgWidth}
      height={svgHeight}
      preserveAspectRatio="xMinYMin meet"
      style={{
        backgroundColor: '#f8f9fa',
        maxWidth: '100%',
        height: 'auto',
      }}
    >
      {screenLayouts.map(({ screen, bounds, labelY }) => (
        <ScreenRendererInternal
          key={screen.id}
          screen={screen}
          bounds={bounds}
          labelY={labelY}
        />
      ))}
    </svg>
  );
}

export default WireframeRenderer;
