/**
 * Container Component Renderers for Wireframe
 *
 * Implements container wireframe elements using rough.js for hand-drawn styling:
 * - ScreenRenderer - Outer screen container with optional label
 * - ColRenderer - Vertical flex container
 * - RowRenderer - Horizontal flex container
 * - CardRenderer - Card with rough.js border/shadow
 */

import React, { useRef, useEffect, useMemo } from 'react';
import rough from 'roughjs';
import { useTheme } from '@/hooks/useTheme';
import { getThemeColors, type WireframeTheme } from '../svg-utils';
import type {
  ScreenComponent,
  ColComponent,
  RowComponent,
  CardComponent,
  LayoutBounds,
  WireframeComponent,
} from '@/types/wireframe';

/**
 * Common props for all container renderers
 */
export interface ContainerRendererProps<T> {
  component: T;
  bounds: LayoutBounds;
  renderChildren: (children: WireframeComponent[], bounds: LayoutBounds) => React.ReactNode;
}

/**
 * Default styling constants
 */
const SCREEN_LABEL_HEIGHT = 24;
const CARD_TITLE_HEIGHT = 32;
const CARD_SHADOW_OFFSET = 3;
const DEFAULT_PADDING = 0;
const BORDER_RADIUS = 8;

/**
 * Get container colors for the given theme
 */
function getContainerColors(theme: WireframeTheme) {
  const colors = getThemeColors(theme);
  return colors.container;
}

/**
 * Rough.js options for hand-drawn effect
 */
const ROUGH_OPTIONS = {
  roughness: 1.2,
  bowing: 0.8,
  strokeWidth: 1.5,
};

/**
 * Calculate content bounds with padding applied
 */
function applyPadding(bounds: LayoutBounds, padding: number): LayoutBounds {
  return {
    x: bounds.x + padding,
    y: bounds.y + padding,
    width: Math.max(0, bounds.width - padding * 2),
    height: Math.max(0, bounds.height - padding * 2),
  };
}

/**
 * ScreenRenderer - Renders the outer screen container with device frame
 *
 * Features:
 * - Device frame outline with rough.js styling
 * - Optional screen name label at the top
 * - Support for background color
 * - Renders children in content area
 */
export const ScreenRenderer: React.FC<ContainerRendererProps<ScreenComponent>> = ({
  component,
  bounds,
  renderChildren,
}) => {
  const groupRef = useRef<SVGGElement>(null);
  const { theme } = useTheme();
  const wireframeTheme: WireframeTheme = theme === 'dark' ? 'dark' : 'light';
  const colors = getContainerColors(wireframeTheme);
  const { id, name, backgroundColor, children } = component;

  // Calculate content bounds (below the label)
  const contentBounds = useMemo(() => ({
    x: bounds.x,
    y: bounds.y + SCREEN_LABEL_HEIGHT,
    width: bounds.width,
    height: bounds.height - SCREEN_LABEL_HEIGHT,
  }), [bounds]);

  // Draw rough.js frame on mount
  useEffect(() => {
    if (!groupRef.current) return;

    const svg = groupRef.current.ownerSVGElement;
    if (!svg) return;

    const rc = rough.svg(svg);

    // Draw device frame
    const frame = rc.rectangle(
      contentBounds.x,
      contentBounds.y,
      contentBounds.width,
      contentBounds.height,
      {
        ...ROUGH_OPTIONS,
        stroke: colors.screenBorder,
        fill: 'none',
      }
    );

    // Insert at beginning so it's behind children
    if (groupRef.current.firstChild) {
      groupRef.current.insertBefore(frame, groupRef.current.firstChild);
    } else {
      groupRef.current.appendChild(frame);
    }

    return () => {
      if (frame.parentNode === groupRef.current) {
        groupRef.current?.removeChild(frame);
      }
    };
  }, [contentBounds, colors]);

  return (
    <g ref={groupRef} data-component-id={id} data-component-type="screen">
      {/* Background rectangle */}
      <rect
        x={contentBounds.x}
        y={contentBounds.y}
        width={contentBounds.width}
        height={contentBounds.height}
        fill={backgroundColor || colors.screenBackground}
        stroke="none"
      />

      {/* Screen label */}
      <text
        x={bounds.x + bounds.width / 2}
        y={bounds.y + SCREEN_LABEL_HEIGHT / 2 + 4}
        textAnchor="middle"
        fontSize={14}
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight={500}
        fill={colors.label}
      >
        {name}
      </text>

      {/* Render children */}
      {children && renderChildren(children, contentBounds)}
    </g>
  );
};

/**
 * ColRenderer - Renders a vertical flex container
 *
 * Features:
 * - Vertical (column) layout direction
 * - Optional padding
 * - Optional gap between children
 * - Transparent container (no visual border)
 */
export const ColRenderer: React.FC<ContainerRendererProps<ColComponent>> = ({
  component,
  bounds,
  renderChildren,
}) => {
  const { id, padding = DEFAULT_PADDING, children } = component;

  // Calculate content bounds with padding
  const contentBounds = useMemo(() => {
    return applyPadding(bounds, padding);
  }, [bounds, padding]);

  return (
    <g data-component-id={id} data-component-type="col">
      {/* Col is a layout container - no visual border, just groups children */}
      {children && renderChildren(children, contentBounds)}
    </g>
  );
};

/**
 * RowRenderer - Renders a horizontal flex container
 *
 * Features:
 * - Horizontal (row) layout direction
 * - Optional padding
 * - Optional gap between children
 * - Transparent container (no visual border)
 */
export const RowRenderer: React.FC<ContainerRendererProps<RowComponent>> = ({
  component,
  bounds,
  renderChildren,
}) => {
  const { id, padding = DEFAULT_PADDING, children } = component;

  // Calculate content bounds with padding
  const contentBounds = useMemo(() => {
    return applyPadding(bounds, padding);
  }, [bounds, padding]);

  return (
    <g data-component-id={id} data-component-type="row">
      {/* Row is a layout container - no visual border, just groups children */}
      {children && renderChildren(children, contentBounds)}
    </g>
  );
};

/**
 * CardRenderer - Renders a card with rough.js border and shadow
 *
 * Features:
 * - Rounded corners with rough.js styling
 * - Subtle shadow effect
 * - Optional title at the top
 * - Optional padding
 * - Renders children in content area
 */
export const CardRenderer: React.FC<ContainerRendererProps<CardComponent>> = ({
  component,
  bounds,
  renderChildren,
}) => {
  const groupRef = useRef<SVGGElement>(null);
  const { theme } = useTheme();
  const wireframeTheme: WireframeTheme = theme === 'dark' ? 'dark' : 'light';
  const colors = getContainerColors(wireframeTheme);
  const { id, title, padding = DEFAULT_PADDING, children } = component;

  // Calculate content bounds (below title if present, with padding)
  const contentBounds = useMemo(() => {
    const titleOffset = title ? CARD_TITLE_HEIGHT : 0;
    const baseBounds = {
      x: bounds.x + padding,
      y: bounds.y + titleOffset + padding,
      width: Math.max(0, bounds.width - padding * 2),
      height: Math.max(0, bounds.height - titleOffset - padding * 2),
    };
    return baseBounds;
  }, [bounds, title, padding]);

  // Draw rough.js card on mount
  useEffect(() => {
    if (!groupRef.current) return;

    const svg = groupRef.current.ownerSVGElement;
    if (!svg) return;

    const rc = rough.svg(svg);

    // Draw card border with rough.js
    const cardBorder = rc.rectangle(
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      {
        ...ROUGH_OPTIONS,
        stroke: colors.cardBorder,
        fill: 'none',
        roughness: 1.0,
      }
    );

    // Insert at beginning so it's behind children
    if (groupRef.current.firstChild) {
      groupRef.current.insertBefore(cardBorder, groupRef.current.firstChild);
    } else {
      groupRef.current.appendChild(cardBorder);
    }

    return () => {
      if (cardBorder.parentNode === groupRef.current) {
        groupRef.current?.removeChild(cardBorder);
      }
    };
  }, [bounds, colors]);

  return (
    <g ref={groupRef} data-component-id={id} data-component-type="card">
      {/* Shadow rectangle (offset slightly) */}
      <rect
        x={bounds.x + CARD_SHADOW_OFFSET}
        y={bounds.y + CARD_SHADOW_OFFSET}
        width={bounds.width}
        height={bounds.height}
        fill={colors.cardShadow}
        rx={BORDER_RADIUS}
        ry={BORDER_RADIUS}
      />

      {/* Card background */}
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill={colors.cardBackground}
        rx={BORDER_RADIUS}
        ry={BORDER_RADIUS}
      />

      {/* Card title if present */}
      {title && (
        <>
          {/* Title separator line */}
          <line
            x1={bounds.x}
            y1={bounds.y + CARD_TITLE_HEIGHT}
            x2={bounds.x + bounds.width}
            y2={bounds.y + CARD_TITLE_HEIGHT}
            stroke={colors.cardBorder}
            strokeWidth={1}
            strokeOpacity={0.3}
          />

          {/* Title text */}
          <text
            x={bounds.x + 12}
            y={bounds.y + CARD_TITLE_HEIGHT / 2 + 5}
            fontSize={14}
            fontFamily="system-ui, -apple-system, sans-serif"
            fontWeight={600}
            fill={colors.text}
          >
            {title}
          </text>
        </>
      )}

      {/* Render children */}
      {children && renderChildren(children, contentBounds)}
    </g>
  );
};

/**
 * Export all container renderers
 */
export default {
  ScreenRenderer,
  ColRenderer,
  RowRenderer,
  CardRenderer,
};
