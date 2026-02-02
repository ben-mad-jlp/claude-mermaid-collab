import React, { useRef, useEffect, useMemo } from 'react';
import type { InputComponent, LayoutBounds } from '../../../types/wireframe';
import { useTheme } from '@/hooks/useTheme';
import { getInputColors, cleanupRoughElements, getRoughSvg, type WireframeTheme } from '../svg-utils';

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
 * Layout constants for input with label
 */
const LABEL_HEIGHT = 20;
const LABEL_GAP = 4;

/**
 * Input component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style input field with:
 * - Optional label above the input
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

  // Calculate input field bounds (below label if present)
  const hasLabel = !!component.label;
  const labelOffset = hasLabel ? LABEL_HEIGHT + LABEL_GAP : 0;
  const inputHeight = bounds.height - labelOffset;

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

    const rc = getRoughSvg(groupRef);
    if (!rc) return;

    const elements: (SVGGElement | null)[] = [];
    const padding = 2;

    // Draw rough rectangle for input border at labelOffset position
    const rectElement = rc.rectangle(
      padding,
      labelOffset + padding,
      bounds.width - padding * 2,
      inputHeight - padding * 2,
      {
        fill: colors.background,
        fillStyle: 'solid',
        stroke: colors.border,
        strokeWidth: 1.5,
        roughness: 0.8,
        bowing: 0.3,
      }
    );
    groupRef.current.appendChild(rectElement);
    elements.push(rectElement);

    // Move rectangle to beginning of group so text is on top
    if (groupRef.current.firstChild && groupRef.current.firstChild !== rectElement) {
      groupRef.current.insertBefore(rectElement, groupRef.current.firstChild);
    }

    // Draw cursor line if has value and not disabled
    if (component.value && !disabled) {
      // Estimate text width (rough approximation)
      const textPadding = 12;
      const charWidth = 8; // Approximate character width
      const textWidth = Math.min(
        textPadding + component.value.length * charWidth,
        bounds.width - textPadding
      );
      const cursorX = textWidth + 2;

      const cursorElement = rc.line(
        cursorX,
        labelOffset + inputHeight * 0.25,
        cursorX,
        labelOffset + inputHeight * 0.75,
        { stroke: colors.text, strokeWidth: 1, roughness: 0.3 }
      );
      groupRef.current.appendChild(cursorElement);
      elements.push(cursorElement);
    }

    return () => {
      cleanupRoughElements(groupRef, elements);
    };
  }, [component.value, disabled, bounds.width, bounds.height, inputHeight, labelOffset, colors, wireframeTheme]);

  const textPadding = 12;

  return (
    <g
      ref={groupRef}
      data-component-type="input"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {/* Label text above input */}
      {hasLabel && (
        <text
          x={0}
          y={LABEL_HEIGHT * 0.7}
          textAnchor="start"
          dominantBaseline="auto"
          fontSize={14}
          fontWeight="500"
          fontFamily="sans-serif"
          fill={colors.text}
        >
          {component.label}
        </text>
      )}

      {/* Input text content with clipping */}
      <clipPath id={`input-clip-${component.id}`}>
        <rect x={textPadding} y={labelOffset} width={bounds.width - textPadding * 2} height={inputHeight} />
      </clipPath>
      <text
        x={textPadding}
        y={labelOffset + inputHeight / 2}
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
