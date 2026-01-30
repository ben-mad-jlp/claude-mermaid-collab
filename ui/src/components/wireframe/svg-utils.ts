/**
 * SVG Utilities for Wireframe Rendering
 *
 * Centralized rough.js SVG helpers and color constants for wireframe components.
 */

import rough from 'roughjs';
import type { RoughSVG } from 'roughjs/bin/svg';
import type { Options } from 'roughjs/bin/core';
import type { LayoutBounds, ButtonVariant } from '../../types/wireframe';

/**
 * Default rough.js options for hand-drawn effect
 */
export const ROUGH_OPTIONS: Options = {
  roughness: 1.2,
  bowing: 0.8,
  strokeWidth: 1.5,
};

/**
 * Color palette for wireframe components
 */
export const COLORS = {
  // Button variants
  button: {
    primary: {
      fill: '#1f2937',
      stroke: '#111827',
      text: '#ffffff',
    },
    secondary: {
      fill: '#ffffff',
      stroke: '#6b7280',
      text: '#374151',
    },
    danger: {
      fill: '#fecaca',
      stroke: '#dc2626',
      text: '#991b1b',
    },
    success: {
      fill: '#bbf7d0',
      stroke: '#16a34a',
      text: '#166534',
    },
    disabled: {
      fill: '#e5e5e5',
      stroke: '#a3a3a3',
      text: '#a3a3a3',
    },
    default: {
      fill: '#f3f4f6',
      stroke: '#9ca3af',
      text: '#1f2937',
    },
  },
  // Input states
  input: {
    normal: {
      background: '#ffffff',
      border: '#9ca3af',
      text: '#374151',
      placeholder: '#9ca3af',
    },
    disabled: {
      background: '#f5f5f5',
      border: '#d4d4d4',
      text: '#a3a3a3',
      placeholder: '#d4d4d4',
    },
  },
  // Navigation colors
  nav: {
    background: '#f8fafc',
    border: '#e2e8f0',
    bottomBorder: '#d1d5db',
    text: '#1f2937',
    icon: '#6b7280',
    active: '#3b82f6',
    activeMenu: '#4338ca',
    activeBackground: '#e0e7ff',
  },
  // Display component colors
  display: {
    avatar: {
      fill: '#e5e7eb',
      stroke: '#9ca3af',
      text: '#4b5563',
      placeholder: '#9ca3af',
    },
    image: {
      fill: '#f3f4f6',
      stroke: '#d1d5db',
      placeholder: '#9ca3af',
      text: '#6b7280',
    },
    icon: {
      stroke: '#6b7280',
      text: '#6b7280',
    },
    list: {
      background: '#ffffff',
      border: '#e5e7eb',
      divider: '#e5e7eb',
      iconStroke: '#6b7280',
      iconText: '#6b7280',
      text: '#374151',
    },
  },
  // Container colors
  container: {
    screenBorder: '#333333',
    screenBackground: '#ffffff',
    cardBorder: '#666666',
    cardBackground: '#ffffff',
    cardShadow: 'rgba(0, 0, 0, 0.15)',
    text: '#333333',
    label: '#666666',
  },
} as const;

/**
 * Get RoughSVG instance from a group ref's ownerSVGElement
 */
export function getRoughSvg(groupRef: React.RefObject<SVGGElement>): RoughSVG | null {
  if (!groupRef.current) return null;
  const svg = groupRef.current.ownerSVGElement;
  if (!svg) return null;
  return rough.svg(svg);
}

/**
 * Append a rough rectangle to a group element
 * Returns the created SVG element for cleanup
 */
export function appendRoughRect(
  groupRef: React.RefObject<SVGGElement>,
  bounds: LayoutBounds,
  options: Options = {}
): SVGGElement | null {
  const rc = getRoughSvg(groupRef);
  if (!rc || !groupRef.current) return null;

  const element = rc.rectangle(
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    { ...ROUGH_OPTIONS, ...options }
  );

  groupRef.current.appendChild(element);
  return element;
}

/**
 * Append a rough rectangle at relative position (0,0) with given size
 * Useful for components that position via the group transform
 */
export function appendRoughRectLocal(
  groupRef: React.RefObject<SVGGElement>,
  width: number,
  height: number,
  options: Options = {}
): SVGGElement | null {
  const rc = getRoughSvg(groupRef);
  if (!rc || !groupRef.current) return null;

  const padding = 2;
  const element = rc.rectangle(
    padding,
    padding,
    width - padding * 2,
    height - padding * 2,
    { ...ROUGH_OPTIONS, ...options }
  );

  groupRef.current.appendChild(element);
  return element;
}

/**
 * Append a rough circle to a group element
 * Returns the created SVG element for cleanup
 */
export function appendRoughCircle(
  groupRef: React.RefObject<SVGGElement>,
  cx: number,
  cy: number,
  diameter: number,
  options: Options = {}
): SVGGElement | null {
  const rc = getRoughSvg(groupRef);
  if (!rc || !groupRef.current) return null;

  const element = rc.circle(cx, cy, diameter, { ...ROUGH_OPTIONS, ...options });
  groupRef.current.appendChild(element);
  return element;
}

/**
 * Append a rough line to a group element
 * Returns the created SVG element for cleanup
 */
export function appendRoughLine(
  groupRef: React.RefObject<SVGGElement>,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: Options = {}
): SVGGElement | null {
  const rc = getRoughSvg(groupRef);
  if (!rc || !groupRef.current) return null;

  const element = rc.line(x1, y1, x2, y2, { ...ROUGH_OPTIONS, ...options });
  groupRef.current.appendChild(element);
  return element;
}

/**
 * Get button colors based on variant and disabled state
 */
export function getButtonColors(
  variant: ButtonVariant,
  disabled: boolean
): { fill: string; stroke: string; text: string } {
  if (disabled) {
    return COLORS.button.disabled;
  }
  return COLORS.button[variant] || COLORS.button.default;
}

/**
 * Get input colors based on disabled state
 */
export function getInputColors(disabled: boolean): {
  background: string;
  border: string;
  text: string;
  placeholder: string;
} {
  return disabled ? COLORS.input.disabled : COLORS.input.normal;
}

/**
 * Clean up rough.js elements from a group
 * Call this in useEffect cleanup
 */
export function cleanupRoughElements(
  groupRef: React.RefObject<SVGGElement>,
  elements: (SVGGElement | null)[]
): void {
  if (!groupRef.current) return;
  elements.forEach((el) => {
    if (el && el.parentNode === groupRef.current) {
      groupRef.current?.removeChild(el);
    }
  });
}
