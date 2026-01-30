/**
 * Wireframe layout calculator - flexbox-style layout for wireframe components
 */
import type {
  WireframeComponent,
  LayoutBounds,
  Viewport,
  Direction,
  ColComponent,
  RowComponent,
  ScreenComponent,
  CardComponent,
} from '../../types/wireframe';

/**
 * Result of layout calculation for a single component
 */
export interface LayoutResult {
  component: WireframeComponent;
  bounds: LayoutBounds;
}

/**
 * Layout direction type
 */
export type LayoutDirection = 'vertical' | 'horizontal';

/**
 * Viewport base dimensions
 */
const VIEWPORT_WIDTHS: Record<Viewport, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 1200,
};

const BASE_HEIGHT = 600;
const SCREEN_GAP = 32;
const SCREEN_PADDING = 16;
const LABEL_SPACE = 32;

/**
 * Determine the layout direction for a component
 *
 * - Col and Screen lay out children vertically
 * - Row lays out children horizontally
 * - Leaf components default to vertical (though they have no children)
 *
 * @param component The wireframe component
 * @returns 'vertical' or 'horizontal'
 */
export function getLayoutDirection(component: WireframeComponent): LayoutDirection {
  if (component.type === 'row') {
    return 'horizontal';
  }
  return 'vertical';
}

/**
 * Calculate total canvas dimensions based on viewport, direction, and screen count
 *
 * @param viewport The viewport type (mobile, tablet, desktop)
 * @param direction The layout direction for multiple screens (LR or TD)
 * @param screenCount Number of screens to display
 * @returns Object with width and height
 */
export function getViewportDimensions(
  viewport: Viewport,
  direction: Direction,
  screenCount: number
): { width: number; height: number } {
  const screenWidth = VIEWPORT_WIDTHS[viewport];
  const screenHeight = BASE_HEIGHT;

  const screenWidthWithPadding = screenWidth + SCREEN_PADDING * 2;
  const screenHeightWithPadding = screenHeight + SCREEN_PADDING * 2 + LABEL_SPACE;

  if (direction === 'LR') {
    return {
      width: screenWidthWithPadding * screenCount + SCREEN_GAP * (screenCount - 1),
      height: screenHeightWithPadding,
    };
  } else {
    return {
      width: screenWidthWithPadding,
      height: screenHeightWithPadding * screenCount + SCREEN_GAP * (screenCount - 1),
    };
  }
}

/**
 * Container component type union
 */
type ContainerComponent = ColComponent | RowComponent | ScreenComponent | CardComponent;

/**
 * Check if a component is a container with children
 */
function isContainer(component: WireframeComponent): component is ContainerComponent {
  return (
    component.type === 'col' ||
    component.type === 'row' ||
    component.type === 'screen' ||
    component.type === 'card'
  );
}

/**
 * Get container properties (gap and padding)
 */
function getContainerProps(component: WireframeComponent): { gap: number; padding: number } {
  if (component.type === 'col' || component.type === 'row' || component.type === 'card') {
    const container = component as ColComponent | RowComponent | CardComponent;
    return {
      gap: container.gap ?? 0,
      padding: container.padding ?? 0,
    };
  }
  return { gap: 0, padding: 0 };
}

/**
 * Calculate layout bounds for a component and all its children recursively
 *
 * This implements a flexbox-style layout algorithm:
 * 1. If component has no children, return bounds as-is
 * 2. Determine direction (vertical for Col/Screen, horizontal for Row)
 * 3. Apply padding to get content area
 * 4. Calculate fixed space (flex: 0) and total flex units
 * 5. Distribute remaining space proportionally among flex children
 * 6. Apply cross-axis alignment
 * 7. Recursively calculate children's children
 *
 * @param component The wireframe component to lay out
 * @param bounds The available bounds for this component
 * @returns Array of LayoutResult for all leaf components
 */
export function calculateLayout(
  component: WireframeComponent,
  bounds: LayoutBounds
): LayoutResult[] {
  // Step 1: Handle leaf nodes (no children)
  if (!isContainer(component)) {
    return [{ component, bounds }];
  }

  const container = component as ContainerComponent;
  const children = container.children;

  // Handle empty children array
  if (!children || children.length === 0) {
    return [];
  }

  // Step 2: Determine direction
  const direction = getLayoutDirection(component);

  // Get container properties
  const { gap, padding } = getContainerProps(component);

  // Step 3: Apply padding to get content area
  const contentBounds: LayoutBounds = {
    x: bounds.x + padding,
    y: bounds.y + padding,
    width: bounds.width - padding * 2,
    height: bounds.height - padding * 2,
  };

  // Step 4: Calculate available space after gaps
  const totalGaps = gap * (children.length - 1);
  const mainAxisTotal =
    direction === 'vertical'
      ? contentBounds.height - totalGaps
      : contentBounds.width - totalGaps;

  // Pass 1: Calculate fixed space and total flex
  let fixedSpace = 0;
  let totalFlex = 0;

  for (const child of children) {
    const flex = (child as any).flex ?? 1; // Default to flex: 1
    if (flex === 0) {
      const size = direction === 'vertical' ? child.bounds.height : child.bounds.width;
      fixedSpace += size > 0 ? size : 0;
    } else {
      totalFlex += flex;
    }
  }

  // Pass 2: Distribute remaining space
  const flexSpace = Math.max(0, mainAxisTotal - fixedSpace);
  const spacePerFlex = totalFlex > 0 ? flexSpace / totalFlex : 0;

  // Calculate bounds for each child
  const results: LayoutResult[] = [];
  let offset = direction === 'vertical' ? contentBounds.y : contentBounds.x;

  for (const child of children) {
    const flex = (child as any).flex ?? 1;
    const align = (child as any).align || 'start';

    // Calculate main axis size
    let mainSize: number;
    if (flex === 0) {
      mainSize = direction === 'vertical' ? child.bounds.height : child.bounds.width;
      if (mainSize <= 0) mainSize = spacePerFlex; // Fallback
    } else {
      mainSize = spacePerFlex * flex;
    }

    // Calculate cross axis size and position
    const crossAxisTotal = direction === 'vertical' ? contentBounds.width : contentBounds.height;
    let crossSize = direction === 'vertical' ? child.bounds.width : child.bounds.height;
    if (crossSize <= 0) crossSize = crossAxisTotal;

    let crossOffset = 0;
    if (align === 'center') crossOffset = (crossAxisTotal - crossSize) / 2;
    else if (align === 'end') crossOffset = crossAxisTotal - crossSize;

    const childBounds: LayoutBounds =
      direction === 'vertical'
        ? {
            x: contentBounds.x + crossOffset,
            y: offset,
            width: crossSize,
            height: mainSize,
          }
        : {
            x: offset,
            y: contentBounds.y + crossOffset,
            width: mainSize,
            height: crossSize,
          };

    // Recursively process child
    const childResults = calculateLayout(child, childBounds);
    results.push(...childResults);

    // Move offset for next child
    offset += mainSize + gap;
  }

  return results;
}
