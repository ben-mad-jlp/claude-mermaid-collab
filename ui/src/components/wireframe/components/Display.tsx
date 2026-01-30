import React, { useRef, useEffect } from 'react';
import type { AvatarComponent, ImageComponent, IconComponent, ListComponent, DividerComponent, LayoutBounds } from '../../../types/wireframe';
import { appendRoughCircle, appendRoughRectLocal, appendRoughLine, cleanupRoughElements, getRoughSvg, COLORS } from '../svg-utils';

/**
 * Props for the Avatar wireframe component renderer
 */
export interface AvatarProps {
  component: AvatarComponent;
  bounds: LayoutBounds;
}

/**
 * Props for the Image wireframe component renderer
 */
export interface ImageProps {
  component: ImageComponent;
  bounds: LayoutBounds;
}

/**
 * Props for the Icon wireframe component renderer
 */
export interface IconProps {
  component: IconComponent;
  bounds: LayoutBounds;
}

/**
 * Props for the List wireframe component renderer
 */
export interface ListProps {
  component: ListComponent;
  bounds: LayoutBounds;
}

/**
 * Avatar component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style circular avatar with:
 * - Rough circle border
 * - Optional initials in center
 */
export function Avatar({ component, bounds }: AvatarProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);

  const size = component.size || Math.min(bounds.width, bounds.height);
  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;

  useEffect(() => {
    if (!groupRef.current) return;

    const elements: (SVGGElement | null)[] = [];

    // Draw rough circle
    const circleElement = appendRoughCircle(groupRef, centerX, centerY, size - 4, {
      fill: COLORS.display.avatar.fill,
      fillStyle: 'solid',
      stroke: COLORS.display.avatar.stroke,
      strokeWidth: 1.5,
      roughness: 0.8,
    });
    elements.push(circleElement);

    // Move circle to beginning so text renders on top
    if (circleElement && groupRef.current.firstChild) {
      groupRef.current.insertBefore(circleElement, groupRef.current.firstChild);
    }

    return () => {
      cleanupRoughElements(groupRef, elements);
    };
  }, [size, centerX, centerY]);

  const radius = size / 2 - 2;

  return (
    <g
      ref={groupRef}
      data-component-type="avatar"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {component.initials ? (
        // Display initials
        <text
          x={centerX}
          y={centerY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.4}
          fontWeight="bold"
          fontFamily="sans-serif"
          fill={COLORS.display.avatar.text}
        >
          {component.initials.toUpperCase().slice(0, 2)}
        </text>
      ) : (
        // Draw person icon placeholder (head + shoulders using circles)
        <>
          <circle
            cx={centerX}
            cy={centerY - radius * 0.2}
            r={radius * 0.3}
            fill={COLORS.display.avatar.placeholder}
          />
          <path
            d={`M ${centerX - radius * 0.5} ${centerY + radius * 0.6}
                A ${radius * 0.5} ${radius * 0.5} 0 0 1 ${centerX + radius * 0.5} ${centerY + radius * 0.6}`}
            fill={COLORS.display.avatar.placeholder}
          />
        </>
      )}
    </g>
  );
}

/**
 * Image component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style image placeholder with:
 * - Rough rectangle border
 * - Diagonal cross lines
 * - Optional alt text
 */
export function Image({ component, bounds }: ImageProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!groupRef.current) return;

    const rc = getRoughSvg(groupRef);
    if (!rc) return;

    const elements: (SVGGElement | null)[] = [];
    const padding = 2;

    // Draw rough rectangle border
    const rectElement = appendRoughRectLocal(groupRef, bounds.width, bounds.height, {
      fill: COLORS.display.image.fill,
      fillStyle: 'solid',
      stroke: COLORS.display.image.stroke,
      strokeWidth: 1.5,
      roughness: 0.8,
    });
    elements.push(rectElement);

    // Draw diagonal lines
    const line1 = rc.line(padding, padding, bounds.width - padding, bounds.height - padding, {
      stroke: COLORS.display.image.stroke,
      strokeWidth: 1,
      roughness: 0.5,
    });
    groupRef.current.appendChild(line1);
    elements.push(line1);

    const line2 = rc.line(bounds.width - padding, padding, padding, bounds.height - padding, {
      stroke: COLORS.display.image.stroke,
      strokeWidth: 1,
      roughness: 0.5,
    });
    groupRef.current.appendChild(line2);
    elements.push(line2);

    // Move all rough elements to beginning so JSX content renders on top
    const firstJsxChild = groupRef.current.querySelector('path, circle, text');
    if (firstJsxChild) {
      elements.forEach(el => {
        if (el && el.parentNode === groupRef.current) {
          groupRef.current!.insertBefore(el, firstJsxChild);
        }
      });
    }

    return () => {
      cleanupRoughElements(groupRef, elements);
    };
  }, [bounds.width, bounds.height]);

  const iconSize = Math.min(bounds.width, bounds.height) * 0.3;
  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;

  return (
    <g
      ref={groupRef}
      data-component-type="image"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {/* Mountain/landscape icon */}
      <path
        d={`M ${centerX - iconSize / 2} ${centerY + iconSize / 3}
            L ${centerX - iconSize / 4} ${centerY - iconSize / 4}
            L ${centerX} ${centerY + iconSize / 6}
            L ${centerX + iconSize / 4} ${centerY - iconSize / 3}
            L ${centerX + iconSize / 2} ${centerY + iconSize / 3}
            Z`}
        fill={COLORS.display.image.placeholder}
      />
      {/* Sun circle */}
      <circle
        cx={centerX + iconSize / 3}
        cy={centerY - iconSize / 3}
        r={iconSize / 6}
        fill={COLORS.display.image.placeholder}
      />
      {/* Alt text */}
      {component.alt && (
        <text
          x={bounds.width / 2}
          y={bounds.height - 8}
          textAnchor="middle"
          dominantBaseline="auto"
          fontSize={12}
          fontFamily="sans-serif"
          fill={COLORS.display.image.text}
        >
          {component.alt}
        </text>
      )}
    </g>
  );
}

/**
 * Icon component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style icon placeholder with:
 * - Rough circle border
 * - First letter of icon name
 */
export function Icon({ component, bounds }: IconProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);

  const size = component.size || Math.min(bounds.width, bounds.height);
  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;

  useEffect(() => {
    if (!groupRef.current) return;

    const rc = getRoughSvg(groupRef);
    if (!rc) return;

    const elements: (SVGGElement | null)[] = [];

    // Draw rough circle
    const circleElement = rc.circle(centerX, centerY, size - 4, {
      stroke: COLORS.display.icon.stroke,
      strokeWidth: 1.5,
      roughness: 0.8,
      fill: 'transparent',
    });
    groupRef.current.appendChild(circleElement);
    elements.push(circleElement);

    // If no name, draw a generic square icon
    if (!component.name) {
      const innerSize = size * 0.4;
      const innerRect = rc.rectangle(
        centerX - innerSize / 2,
        centerY - innerSize / 2,
        innerSize,
        innerSize,
        {
          stroke: COLORS.display.icon.stroke,
          strokeWidth: 1,
          roughness: 0.5,
        }
      );
      groupRef.current.appendChild(innerRect);
      elements.push(innerRect);
    }

    // Move rough elements to beginning so text renders on top
    const textElement = groupRef.current.querySelector('text');
    if (textElement) {
      elements.forEach(el => {
        if (el && el.parentNode === groupRef.current) {
          groupRef.current!.insertBefore(el, textElement);
        }
      });
    }

    return () => {
      cleanupRoughElements(groupRef, elements);
    };
  }, [size, centerX, centerY, component.name]);

  return (
    <g
      ref={groupRef}
      data-component-type="icon"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {/* Icon letter */}
      {component.name && (
        <text
          x={centerX}
          y={centerY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.5}
          fontFamily="sans-serif"
          fill={COLORS.display.icon.text}
        >
          {component.name.charAt(0).toUpperCase()}
        </text>
      )}
    </g>
  );
}

/**
 * List component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style list with:
 * - Background
 * - List items with optional icons
 * - Optional dividers between items
 */
export function List({ component, bounds }: ListProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);

  const items = component.items || [];
  const itemHeight = 48;
  const padding = 16;
  const iconSize = 20;

  useEffect(() => {
    if (!groupRef.current) return;

    const rc = getRoughSvg(groupRef);
    if (!rc) return;

    const elements: (SVGGElement | null)[] = [];

    // Draw list background
    const bgElement = rc.rectangle(0, 0, bounds.width, bounds.height, {
      fill: COLORS.display.list.background,
      fillStyle: 'solid',
      stroke: COLORS.display.list.border,
      strokeWidth: 1,
      roughness: 0.5,
    });
    groupRef.current.appendChild(bgElement);
    elements.push(bgElement);

    // Draw dividers and icon circles
    items.forEach((item, index) => {
      const y = index * itemHeight;

      // Draw divider if enabled and not first item
      if (component.dividers && index > 0) {
        const divider = rc.line(padding, y, bounds.width - padding, y, {
          stroke: COLORS.display.list.divider,
          strokeWidth: 1,
          roughness: 0.3,
        });
        groupRef.current!.appendChild(divider);
        elements.push(divider);
      }

      // Draw icon circle if present
      if (item.icon) {
        const iconX = padding + iconSize / 2;
        const iconY = y + itemHeight / 2;

        const iconCircle = rc.circle(iconX, iconY, iconSize, {
          stroke: COLORS.display.list.iconStroke,
          strokeWidth: 1.5,
          roughness: 0.8,
          fill: 'none',
        });
        groupRef.current!.appendChild(iconCircle);
        elements.push(iconCircle);
      }
    });

    // Move rough elements to beginning so text renders on top
    const firstTextGroup = groupRef.current.querySelector('g');
    if (firstTextGroup) {
      elements.forEach(el => {
        if (el && el.parentNode === groupRef.current) {
          groupRef.current!.insertBefore(el, firstTextGroup);
        }
      });
    }

    return () => {
      cleanupRoughElements(groupRef, elements);
    };
  }, [bounds.width, bounds.height, items, component.dividers]);

  return (
    <g
      ref={groupRef}
      data-component-type="list"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {/* List items text */}
      {items.map((item, index) => {
        const y = index * itemHeight;
        const textX = item.icon ? padding + iconSize + 12 : padding;

        return (
          <g key={item.id || index}>
            {/* Icon letter */}
            {item.icon && (
              <text
                x={padding + iconSize / 2}
                y={y + itemHeight / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={iconSize * 0.5}
                fontFamily="sans-serif"
                fill={COLORS.display.list.iconText}
              >
                {item.icon.charAt(0).toUpperCase()}
              </text>
            )}
            {/* Label */}
            <text
              x={textX}
              y={y + itemHeight / 2}
              textAnchor="start"
              dominantBaseline="middle"
              fontSize={14}
              fontFamily="sans-serif"
              fill={COLORS.display.list.text}
            >
              {item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Props for the Divider wireframe component renderer
 */
export interface DividerProps {
  component: DividerComponent;
  bounds: LayoutBounds;
}

/**
 * Divider component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style divider line (horizontal or vertical)
 */
export function Divider({ component, bounds }: DividerProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);
  const isVertical = component.orientation === 'vertical';

  useEffect(() => {
    if (!groupRef.current) return;

    const elements: (SVGGElement | null)[] = [];

    // Draw rough line
    const lineElement = appendRoughLine(
      groupRef,
      isVertical ? bounds.width / 2 : 0,
      isVertical ? 0 : bounds.height / 2,
      isVertical ? bounds.width / 2 : bounds.width,
      isVertical ? bounds.height : bounds.height / 2,
      {
        stroke: '#e5e7eb',
        strokeWidth: 1,
        roughness: 0.5,
      }
    );
    elements.push(lineElement);

    return () => {
      cleanupRoughElements(groupRef, elements);
    };
  }, [bounds.width, bounds.height, isVertical]);

  return (
    <g
      ref={groupRef}
      data-component-type="divider"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    />
  );
}
