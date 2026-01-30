import React, { useRef, useEffect } from 'react';
import type { ButtonComponent, LayoutBounds } from '../../../types/wireframe';
import { appendRoughRectLocal, getButtonColors, cleanupRoughElements } from '../svg-utils';

/**
 * Props for the Button wireframe component renderer
 */
export interface ButtonProps {
  /** The button component data */
  component: ButtonComponent;
  /** Layout bounds for positioning and sizing */
  bounds: LayoutBounds;
}

/**
 * Button component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style button with:
 * - Rough rectangle with rounded corners
 * - Variant-based fill colors
 * - Centered label text
 */
export function Button({ component, bounds }: ButtonProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!groupRef.current) return;

    // Get colors based on variant
    const variant = component.variant || 'default';
    const disabled = component.disabled || false;
    const colors = getButtonColors(variant, disabled);

    // Draw rough rectangle - insert at beginning so text renders on top
    const rectElement = appendRoughRectLocal(groupRef, bounds.width, bounds.height, {
      fill: colors.fill,
      fillStyle: 'solid',
      stroke: colors.stroke,
      strokeWidth: 1.5,
      roughness: 1,
      bowing: 0.5,
    });

    // Move rectangle to beginning of group so text is on top
    if (rectElement && groupRef.current.firstChild) {
      groupRef.current.insertBefore(rectElement, groupRef.current.firstChild);
    }

    return () => {
      cleanupRoughElements(groupRef, [rectElement]);
    };
  }, [component.variant, component.disabled, bounds.width, bounds.height]);

  const variant = component.variant || 'default';
  const disabled = component.disabled || false;
  const colors = getButtonColors(variant, disabled);
  const label = component.label || 'Button';

  return (
    <g
      ref={groupRef}
      data-component-type="button"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {/* Label text centered in bounds */}
      <text
        x={bounds.width / 2}
        y={bounds.height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={14}
        fontWeight="bold"
        fontFamily="sans-serif"
        fill={colors.text}
      >
        {label}
      </text>
    </g>
  );
}
