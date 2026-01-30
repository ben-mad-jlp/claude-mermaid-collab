import React, { useRef, useEffect, useMemo } from 'react';
import type { InputComponent, LayoutBounds } from '../../../types/wireframe';
import { useTheme } from '@/hooks/useTheme';
import { appendRoughRectLocal, appendRoughLine, getInputColors, cleanupRoughElements, getRoughSvg, type WireframeTheme } from '../svg-utils';

/**
 * Props for the Input wireframe component renderer
 */
export interface InputProps {
  /** The input component data */
  component: InputComponent;
  /** Layout bounds for positioning and sizing */
  bounds: LayoutBounds;
}

/**
 * Input component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style input field with:
 * - Rough rectangle border
 * - Placeholder or value text
 * - Disabled state styling
 */
export function Input({ component, bounds }: InputProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);
  const { theme } = useTheme();
  const wireframeTheme: WireframeTheme = theme === 'dark' ? 'dark' : 'light';

  const disabled = component.disabled || false;
  const colors = getInputColors(disabled, wireframeTheme);

  // Determine text to display
  const { displayText, textColor } = useMemo(() => {
    if (component.value) {
      // If password type, mask the value
      if (component.inputType === 'password') {
        return { displayText: '\u2022'.repeat(component.value.length), textColor: colors.text };
      }
      return { displayText: component.value, textColor: colors.text };
    }
    if (component.placeholder) {
      return { displayText: component.placeholder, textColor: colors.placeholder };
    }
    return { displayText: 'Enter text...', textColor: colors.placeholder };
  }, [component.value, component.placeholder, component.inputType, colors]);

  useEffect(() => {
    if (!groupRef.current) return;

    // Draw rough rectangle for input border - insert at beginning so text is on top
    const rectElement = appendRoughRectLocal(groupRef, bounds.width, bounds.height, {
      fill: colors.background,
      fillStyle: 'solid',
      stroke: colors.border,
      strokeWidth: 1.5,
      roughness: 0.8,
      bowing: 0.3,
    });

    // Move rectangle to beginning of group so text is on top
    if (rectElement && groupRef.current.firstChild) {
      groupRef.current.insertBefore(rectElement, groupRef.current.firstChild);
    }

    // Draw cursor line if has value and not disabled
    let cursorElement: SVGGElement | null = null;
    if (component.value && !disabled) {
      const rc = getRoughSvg(groupRef);
      if (rc && groupRef.current) {
        // Estimate text width (rough approximation)
        const textPadding = 12;
        const charWidth = 8; // Approximate character width
        const textWidth = Math.min(
          textPadding + component.value.length * charWidth,
          bounds.width - textPadding
        );
        const cursorX = textWidth + 2;

        cursorElement = rc.line(
          cursorX,
          bounds.height * 0.25,
          cursorX,
          bounds.height * 0.75,
          { stroke: colors.text, strokeWidth: 1, roughness: 0.3 }
        );
        groupRef.current.appendChild(cursorElement);
      }
    }

    return () => {
      cleanupRoughElements(groupRef, [rectElement, cursorElement]);
    };
  }, [component.value, disabled, bounds.width, bounds.height, colors, wireframeTheme]);

  const textPadding = 12;

  return (
    <g
      ref={groupRef}
      data-component-type="input"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {/* Text content with clipping */}
      <clipPath id={`input-clip-${component.id}`}>
        <rect x={textPadding} y={0} width={bounds.width - textPadding * 2} height={bounds.height} />
      </clipPath>
      <text
        x={textPadding}
        y={bounds.height / 2}
        textAnchor="start"
        dominantBaseline="middle"
        fontSize={14}
        fontFamily="sans-serif"
        fill={textColor}
        clipPath={`url(#input-clip-${component.id})`}
      >
        {displayText}
      </text>
    </g>
  );
}
