/**
 * Text and Title component renderers for wireframe diagrams
 *
 * These components render text content with hand-drawn styling
 * using rough.js-inspired aesthetics for wireframe visualization.
 */

import type { TextComponent, LayoutBounds } from '../../../types/wireframe';
import { useTheme } from '../../../hooks/useTheme';

/**
 * Theme color definitions for text rendering
 */
const THEME_COLORS = {
  light: {
    text: '#1f2937', // gray-800
    title: '#111827', // gray-900
  },
  dark: {
    text: '#f3f4f6', // gray-100
    title: '#ffffff', // white
  },
} as const;

/**
 * Hand-drawn style font family for wireframe aesthetics
 */
const HAND_DRAWN_FONT = '"Comic Sans MS", "Comic Neue", cursive, sans-serif';

/**
 * Default font sizes for text and title components
 */
const DEFAULT_FONT_SIZES = {
  text: 14,
  title: 24,
} as const;

/**
 * Props for text renderer components
 */
export interface TextRendererProps {
  /** The text component data */
  component: TextComponent;
  /** The calculated layout bounds for positioning */
  bounds: LayoutBounds;
}

/**
 * Calculates the vertical center position for text within bounds
 * Accounts for font baseline adjustment
 */
function calculateTextY(bounds: LayoutBounds, fontSize: number): number {
  // Center text vertically with baseline adjustment (roughly 0.35 of font size)
  return bounds.y + bounds.height / 2 + fontSize * 0.35;
}

/**
 * TextRenderer component
 *
 * Renders text content with hand-drawn styling for wireframe diagrams.
 * Supports custom font size, weight, and color with theme-aware defaults.
 *
 * @example
 * ```tsx
 * <svg>
 *   <TextRenderer
 *     component={{ id: 'text-1', type: 'text', content: 'Hello', bounds: {...} }}
 *     bounds={{ x: 10, y: 20, width: 100, height: 30 }}
 *   />
 * </svg>
 * ```
 */
export function TextRenderer({ component, bounds }: TextRendererProps): JSX.Element {
  const { theme } = useTheme();
  const themeColors = THEME_COLORS[theme];

  // Determine text styling
  const fontSize = component.fontSize ?? DEFAULT_FONT_SIZES.text;
  const fontWeight = component.fontWeight ?? 'normal';
  const fill = component.color ?? themeColors.text;

  // Calculate position
  const x = bounds.x;
  const y = calculateTextY(bounds, fontSize);

  return (
    <text
      x={x.toString()}
      y={y.toString()}
      fontSize={fontSize.toString()}
      fontWeight={fontWeight}
      fontFamily={HAND_DRAWN_FONT}
      fill={fill}
      textAnchor="start"
      dominantBaseline="middle"
    >
      {component.content}
    </text>
  );
}

/**
 * TitleRenderer component
 *
 * Renders title text with larger, bolder hand-drawn styling.
 * Uses larger default font size and bold weight compared to TextRenderer.
 *
 * @example
 * ```tsx
 * <svg>
 *   <TitleRenderer
 *     component={{ id: 'title-1', type: 'text', content: 'Page Title', bounds: {...} }}
 *     bounds={{ x: 10, y: 20, width: 200, height: 50 }}
 *   />
 * </svg>
 * ```
 */
export function TitleRenderer({ component, bounds }: TextRendererProps): JSX.Element {
  const { theme } = useTheme();
  const themeColors = THEME_COLORS[theme];

  // Determine text styling with title defaults
  const fontSize = component.fontSize ?? DEFAULT_FONT_SIZES.title;
  const fontWeight = component.fontWeight ?? 'bold';
  const fill = component.color ?? themeColors.title;

  // Calculate position
  const x = bounds.x;
  const y = calculateTextY(bounds, fontSize);

  return (
    <text
      x={x.toString()}
      y={y.toString()}
      fontSize={fontSize.toString()}
      fontWeight={fontWeight}
      fontFamily={HAND_DRAWN_FONT}
      fill={fill}
      textAnchor="start"
      dominantBaseline="middle"
    >
      {component.content}
    </text>
  );
}
