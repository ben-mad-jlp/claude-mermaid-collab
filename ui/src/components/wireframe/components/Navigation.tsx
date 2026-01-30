import React, { useRef, useEffect } from 'react';
import type { AppBarComponent, BottomNavComponent, NavMenuComponent, LayoutBounds } from '../../../types/wireframe';
import { useTheme } from '@/hooks/useTheme';
import { appendRoughRectLocal, appendRoughCircle, appendRoughLine, cleanupRoughElements, getRoughSvg, getThemeColors, type WireframeTheme } from '../svg-utils';

/**
 * Props for the AppBar wireframe component renderer
 */
export interface AppBarProps {
  component: AppBarComponent;
  bounds: LayoutBounds;
}

/**
 * Props for the BottomNav wireframe component renderer
 */
export interface BottomNavProps {
  component: BottomNavComponent;
  bounds: LayoutBounds;
}

/**
 * Props for the NavMenu wireframe component renderer
 */
export interface NavMenuProps {
  component: NavMenuComponent;
  bounds: LayoutBounds;
}

/**
 * AppBar component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style app bar with:
 * - Background bar
 * - Title text
 * - Optional left icon (menu)
 * - Optional right icons
 */
export function AppBar({ component, bounds }: AppBarProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);
  const { theme } = useTheme();
  const wireframeTheme: WireframeTheme = theme === 'dark' ? 'dark' : 'light';
  const colors = getThemeColors(wireframeTheme);

  useEffect(() => {
    if (!groupRef.current) return;

    const rc = getRoughSvg(groupRef);
    if (!rc) return;

    const elements: (SVGGElement | null)[] = [];

    // Helper to insert at beginning (behind React children)
    const insertAtStart = (el: SVGGElement) => {
      if (groupRef.current!.firstChild) {
        groupRef.current!.insertBefore(el, groupRef.current!.firstChild);
      } else {
        groupRef.current!.appendChild(el);
      }
    };

    // Draw app bar background - insert at start so text renders on top
    const bgElement = rc.rectangle(0, 0, bounds.width, bounds.height, {
      fill: colors.nav.background,
      fillStyle: 'solid',
      stroke: colors.nav.border,
      strokeWidth: 1,
      roughness: 0.5,
    });
    insertAtStart(bgElement);
    elements.push(bgElement);

    // Draw bottom border - insert after bg
    const borderElement = rc.line(0, bounds.height - 1, bounds.width, bounds.height - 1, {
      stroke: colors.nav.bottomBorder,
      strokeWidth: 1,
      roughness: 0.3,
    });
    if (bgElement.nextSibling) {
      groupRef.current.insertBefore(borderElement, bgElement.nextSibling);
    } else {
      groupRef.current.appendChild(borderElement);
    }
    elements.push(borderElement);

    // Draw left icon circle if present - not filled, can append
    const iconSize = 24;
    const padding = 16;
    if (component.leftIcon) {
      const iconCircle = rc.circle(padding + iconSize / 2, bounds.height / 2, iconSize, {
        stroke: colors.nav.icon,
        strokeWidth: 1.5,
        roughness: 0.8,
        fill: 'none',
      });
      groupRef.current.appendChild(iconCircle);
      elements.push(iconCircle);
    }

    // Draw right icon circles - not filled, can append
    if (component.rightIcons && component.rightIcons.length > 0) {
      let rightX = bounds.width - padding - iconSize / 2;
      for (let i = component.rightIcons.length - 1; i >= 0; i--) {
        const iconCircle = rc.circle(rightX, bounds.height / 2, iconSize, {
          stroke: colors.nav.icon,
          strokeWidth: 1.5,
          roughness: 0.8,
          fill: 'none',
        });
        groupRef.current.appendChild(iconCircle);
        elements.push(iconCircle);
        rightX -= iconSize + 8;
      }
    }

    return () => {
      cleanupRoughElements(groupRef, elements);
    };
  }, [component, bounds, colors]);

  const iconSize = 24;
  const padding = 16;
  const titleX = component.leftIcon ? padding + iconSize + 12 : padding;

  return (
    <g
      ref={groupRef}
      data-component-type="appbar"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {/* Left icon letter */}
      {component.leftIcon && (
        <text
          x={padding + iconSize / 2}
          y={bounds.height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={iconSize * 0.5}
          fontFamily="sans-serif"
          fill={colors.nav.icon}
        >
          {component.leftIcon.charAt(0).toUpperCase()}
        </text>
      )}

      {/* Title */}
      {component.title && (
        <text
          x={titleX}
          y={bounds.height / 2}
          textAnchor="start"
          dominantBaseline="middle"
          fontSize={18}
          fontWeight="bold"
          fontFamily="sans-serif"
          fill={colors.nav.text}
        >
          {component.title}
        </text>
      )}

      {/* Right icon letters */}
      {component.rightIcons?.map((icon, index) => {
        const rightX = bounds.width - padding - iconSize / 2 - (component.rightIcons!.length - 1 - index) * (iconSize + 8);
        return (
          <text
            key={index}
            x={rightX}
            y={bounds.height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={iconSize * 0.5}
            fontFamily="sans-serif"
            fill={colors.nav.icon}
          >
            {icon.charAt(0).toUpperCase()}
          </text>
        );
      })}
    </g>
  );
}

/**
 * BottomNav component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style bottom navigation with:
 * - Background bar
 * - Evenly spaced nav items with icons and labels
 * - Active state indicator
 */
export function BottomNav({ component, bounds }: BottomNavProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);
  const { theme } = useTheme();
  const wireframeTheme: WireframeTheme = theme === 'dark' ? 'dark' : 'light';
  const colors = getThemeColors(wireframeTheme);

  useEffect(() => {
    if (!groupRef.current) return;

    const rc = getRoughSvg(groupRef);
    if (!rc) return;

    const elements: (SVGGElement | null)[] = [];

    // Helper to insert at beginning (behind React children)
    const insertAtStart = (el: SVGGElement) => {
      if (groupRef.current!.firstChild) {
        groupRef.current!.insertBefore(el, groupRef.current!.firstChild);
      } else {
        groupRef.current!.appendChild(el);
      }
    };

    // Draw bottom nav background - insert at start so text renders on top
    const bgElement = rc.rectangle(0, 0, bounds.width, bounds.height, {
      fill: colors.nav.background,
      fillStyle: 'solid',
      stroke: colors.nav.border,
      strokeWidth: 1,
      roughness: 0.5,
    });
    insertAtStart(bgElement);
    elements.push(bgElement);

    // Draw top border - insert after bg
    const borderElement = rc.line(0, 1, bounds.width, 1, {
      stroke: colors.nav.bottomBorder,
      strokeWidth: 1,
      roughness: 0.3,
    });
    if (bgElement.nextSibling) {
      groupRef.current.insertBefore(borderElement, bgElement.nextSibling);
    } else {
      groupRef.current.appendChild(borderElement);
    }
    elements.push(borderElement);

    // Draw icon circles for each item - these are not filled, can append
    const items = component.items || [];
    if (items.length > 0) {
      const itemWidth = bounds.width / items.length;
      const iconSize = 20;
      const activeIndex = component.activeIndex ?? 0;

      items.forEach((item, index) => {
        const centerX = itemWidth * index + itemWidth / 2;
        const iconY = bounds.height * 0.35;
        const isActive = index === activeIndex;
        const color = isActive ? colors.nav.active : colors.nav.icon;

        const iconCircle = rc.circle(centerX, iconY, iconSize, {
          stroke: color,
          strokeWidth: isActive ? 2 : 1.5,
          roughness: 0.8,
          fill: 'none',
        });
        groupRef.current!.appendChild(iconCircle);
        elements.push(iconCircle);
      });
    }

    return () => {
      cleanupRoughElements(groupRef, elements);
    };
  }, [component, bounds, colors]);

  const items = component.items || [];
  const itemWidth = items.length > 0 ? bounds.width / items.length : bounds.width;
  const iconSize = 20;
  const activeIndex = component.activeIndex ?? 0;

  return (
    <g
      ref={groupRef}
      data-component-type="bottomnav"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {/* Nav item labels and icon letters */}
      {items.map((item, index) => {
        const centerX = itemWidth * index + itemWidth / 2;
        const iconY = bounds.height * 0.35;
        const labelY = bounds.height * 0.75;
        const isActive = index === activeIndex;
        const color = isActive ? colors.nav.active : colors.nav.icon;

        return (
          <g key={index}>
            {/* Icon letter */}
            {item.icon && (
              <text
                x={centerX}
                y={iconY}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={iconSize * 0.5}
                fontFamily="sans-serif"
                fill={color}
              >
                {item.icon.charAt(0).toUpperCase()}
              </text>
            )}
            {/* Label */}
            <text
              x={centerX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={isActive ? 'bold' : 'normal'}
              fontFamily="sans-serif"
              fill={color}
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
 * NavMenu component renderer for wireframe elements using rough.js SVG
 *
 * Renders a hand-drawn style navigation menu with:
 * - Background
 * - List of nav items with optional icons
 * - Active state styling
 * - Horizontal or vertical layout
 */
export function NavMenu({ component, bounds }: NavMenuProps): JSX.Element {
  const groupRef = useRef<SVGGElement>(null);
  const { theme } = useTheme();
  const wireframeTheme: WireframeTheme = theme === 'dark' ? 'dark' : 'light';
  const colors = getThemeColors(wireframeTheme);

  const items = component.items || [];
  const variant = component.variant || 'vertical';

  useEffect(() => {
    if (!groupRef.current) return;

    const rc = getRoughSvg(groupRef);
    if (!rc) return;

    const elements: (SVGGElement | null)[] = [];

    // Helper to insert at beginning (behind React children)
    const insertAtStart = (el: SVGGElement) => {
      if (groupRef.current!.firstChild) {
        groupRef.current!.insertBefore(el, groupRef.current!.firstChild);
      } else {
        groupRef.current!.appendChild(el);
      }
    };

    // Draw menu background - insert at start so text renders on top
    const bgElement = rc.rectangle(0, 0, bounds.width, bounds.height, {
      fill: colors.nav.background,
      fillStyle: 'solid',
      stroke: colors.nav.border,
      strokeWidth: 1,
      roughness: 0.5,
    });
    insertAtStart(bgElement);
    elements.push(bgElement);

    if (items.length === 0) {
      return () => cleanupRoughElements(groupRef, elements);
    }

    const iconSize = 18;

    if (variant === 'vertical') {
      const itemHeight = 44;

      items.forEach((item, index) => {
        const y = index * itemHeight;
        const isActive = item.active || false;

        // Draw active background - insert after bg but before text
        if (isActive) {
          const activeBg = rc.rectangle(0, y, bounds.width, itemHeight, {
            fill: colors.nav.activeBackground,
            fillStyle: 'solid',
            stroke: 'transparent',
            roughness: 0.3,
          });
          // Insert after background element
          if (bgElement.nextSibling) {
            groupRef.current!.insertBefore(activeBg, bgElement.nextSibling);
          } else {
            groupRef.current!.appendChild(activeBg);
          }
          elements.push(activeBg);
        }

        // Draw icon circle if present - these can go at end since they're not filled
        if (item.icon) {
          const iconColor = isActive ? colors.nav.activeMenu : colors.nav.text;
          const iconX = 12 + iconSize / 2;
          const iconY = y + itemHeight / 2;

          const iconCircle = rc.circle(iconX, iconY, iconSize, {
            stroke: iconColor,
            strokeWidth: 1.5,
            roughness: 0.8,
            fill: 'none',
          });
          groupRef.current!.appendChild(iconCircle);
          elements.push(iconCircle);
        }
      });
    } else {
      // Horizontal layout - draw active indicator (line, not filled, can append)
      const itemWidth = bounds.width / items.length;

      items.forEach((item, index) => {
        const x = index * itemWidth;
        const isActive = item.active || false;

        if (isActive) {
          const activeIndicator = rc.line(x + 8, bounds.height - 3, x + itemWidth - 8, bounds.height - 3, {
            stroke: colors.nav.activeMenu,
            strokeWidth: 3,
            roughness: 0.3,
          });
          groupRef.current!.appendChild(activeIndicator);
          elements.push(activeIndicator);
        }
      });
    }

    return () => {
      cleanupRoughElements(groupRef, elements);
    };
  }, [component, bounds, items, variant, colors]);

  const iconSize = 18;
  const padding = 12;

  return (
    <g
      ref={groupRef}
      data-component-type="navmenu"
      transform={`translate(${bounds.x}, ${bounds.y})`}
    >
      {variant === 'vertical' ? (
        // Vertical layout
        items.map((item, index) => {
          const itemHeight = 44;
          const y = index * itemHeight;
          const isActive = item.active || false;
          const textColor = isActive ? colors.nav.activeMenu : colors.nav.text;
          const textX = item.icon ? padding + iconSize + 12 : padding;

          return (
            <g key={index}>
              {/* Icon letter */}
              {item.icon && (
                <text
                  x={padding + iconSize / 2}
                  y={y + itemHeight / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={iconSize * 0.5}
                  fontFamily="sans-serif"
                  fill={textColor}
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
                fontWeight={isActive ? 'bold' : 'normal'}
                fontFamily="sans-serif"
                fill={textColor}
              >
                {item.label}
              </text>
            </g>
          );
        })
      ) : (
        // Horizontal layout - centered icon + label
        items.map((item, index) => {
          const itemWidth = bounds.width / items.length;
          const x = index * itemWidth;
          const centerX = x + itemWidth / 2;
          const isActive = item.active || false;
          const textColor = isActive ? colors.nav.activeMenu : colors.nav.text;

          return (
            <g key={index}>
              {/* Icon letter */}
              {item.icon && (
                <text
                  x={centerX - 20}
                  y={bounds.height / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={14}
                  fontFamily="sans-serif"
                  fill={textColor}
                >
                  {item.icon.charAt(0).toUpperCase()}
                </text>
              )}
              {/* Label */}
              <text
                x={centerX + (item.icon ? 10 : 0)}
                y={bounds.height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={14}
                fontWeight={isActive ? 'bold' : 'normal'}
                fontFamily="sans-serif"
                fill={textColor}
              >
                {item.label}
              </text>
            </g>
          );
        })
      )}
    </g>
  );
}
