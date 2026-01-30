/**
 * Server-side wireframe SVG renderer
 *
 * Generates clean SVG from wireframe JSON without rough.js effects.
 * Used for the MCP export_wireframe_svg tool to produce viewable images.
 */

// Type definitions (mirrored from ui/src/types/wireframe.ts for server-side use)
export type Viewport = 'mobile' | 'tablet' | 'desktop';
export type Direction = 'LR' | 'TD';
export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'danger' | 'success' | 'disabled';

export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BaseComponent {
  id: string;
  type: string;
  bounds: LayoutBounds;
  label?: string;
  flex?: number;                              // 0 = fixed size (use bounds), 1+ = proportional flex
  align?: 'start' | 'center' | 'end';         // Cross-axis alignment
}

export interface ScreenComponent extends BaseComponent {
  type: 'screen';
  name: string;
  backgroundColor?: string;
  children: WireframeComponent[];
}

export interface ColComponent extends BaseComponent {
  type: 'col';
  gap?: number;
  padding?: number;
  children: WireframeComponent[];
}

export interface RowComponent extends BaseComponent {
  type: 'row';
  gap?: number;
  padding?: number;
  children: WireframeComponent[];
}

export interface ButtonComponent extends BaseComponent {
  type: 'button';
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
}

export interface InputComponent extends BaseComponent {
  type: 'input';
  placeholder?: string;
  value?: string;
  inputType?: string;
  disabled?: boolean;
}

export interface TextComponent extends BaseComponent {
  type: 'text';
  content: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
}

export interface CardComponent extends BaseComponent {
  type: 'card';
  title?: string;
  gap?: number;
  padding?: number;
  children: WireframeComponent[];
}

export interface NavItem {
  label: string;
  icon?: string;
  active?: boolean;
}

export interface AppBarComponent extends BaseComponent {
  type: 'appbar';
  title?: string;
  leftIcon?: string;
  rightIcons?: string[];
}

export interface BottomNavComponent extends BaseComponent {
  type: 'bottomnav';
  items: NavItem[];
  activeIndex?: number;
}

export interface NavMenuComponent extends BaseComponent {
  type: 'navmenu';
  items: NavItem[];
  variant?: 'horizontal' | 'vertical';
}

export interface AvatarComponent extends BaseComponent {
  type: 'avatar';
  size?: number;
  initials?: string;
}

export interface ImageComponent extends BaseComponent {
  type: 'image';
  alt?: string;
  aspectRatio?: string;
}

export interface IconComponent extends BaseComponent {
  type: 'icon';
  name?: string;
  size?: number;
}

export interface ListItemData {
  id: string;
  label: string;
  icon?: string;
}

export interface DividerComponent extends BaseComponent {
  type: 'divider';
  orientation?: 'horizontal' | 'vertical';
}

export interface ListComponent extends BaseComponent {
  type: 'list';
  items: ListItemData[];
  dividers?: boolean;
}

export interface WireframeRoot {
  viewport: Viewport;
  direction: Direction;
  screens: ScreenComponent[];
}

export type WireframeComponent =
  | ScreenComponent
  | ColComponent
  | RowComponent
  | CardComponent
  | ButtonComponent
  | InputComponent
  | TextComponent
  | AppBarComponent
  | BottomNavComponent
  | NavMenuComponent
  | AvatarComponent
  | ImageComponent
  | IconComponent
  | ListComponent
  | DividerComponent;

// Layout constants
const VIEWPORT_WIDTHS: Record<Viewport, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 1200,
};
const BASE_HEIGHT = 600;
const SCREEN_GAP = 32;
const SCREEN_PADDING = 16;
const LABEL_SPACE = 32;

// Color palette
const COLORS = {
  button: {
    primary: { fill: '#3b82f6', stroke: '#2563eb', text: '#ffffff' },
    secondary: { fill: '#e5e7eb', stroke: '#9ca3af', text: '#374151' },
    danger: { fill: '#ef4444', stroke: '#dc2626', text: '#ffffff' },
    success: { fill: '#22c55e', stroke: '#16a34a', text: '#ffffff' },
    disabled: { fill: '#f3f4f6', stroke: '#d1d5db', text: '#9ca3af' },
    default: { fill: '#ffffff', stroke: '#d1d5db', text: '#374151' },
  },
  input: {
    normal: { background: '#ffffff', border: '#d1d5db', text: '#374151', placeholder: '#9ca3af' },
    disabled: { background: '#f3f4f6', border: '#e5e7eb', text: '#9ca3af', placeholder: '#d1d5db' },
  },
  nav: {
    background: '#ffffff',
    border: '#e5e7eb',
    text: '#374151',
    active: '#3b82f6',
  },
  display: {
    avatar: { fill: '#e5e7eb', stroke: '#9ca3af', text: '#6b7280' },
    image: { fill: '#f3f4f6', stroke: '#d1d5db', icon: '#9ca3af' },
    icon: { fill: '#6b7280' },
    list: { background: '#ffffff', border: '#e5e7eb', text: '#374151' },
  },
  container: {
    screenBorder: '#374151',
    cardBorder: '#e5e7eb',
  },
};

/**
 * Escape special XML characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Calculate viewport dimensions
 */
function getViewportDimensions(
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
 * Render a button component to SVG
 */
function renderButton(component: ButtonComponent, bounds: LayoutBounds): string {
  const variant = component.disabled ? 'disabled' : (component.variant || 'default');
  const colors = COLORS.button[variant] || COLORS.button.default;
  const label = escapeXml(component.label || 'Button');

  return `
    <g data-component-type="button">
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
            fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5" rx="4"/>
      <text x="${bounds.x + bounds.width / 2}" y="${bounds.y + bounds.height / 2}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="sans-serif" font-size="14" fill="${colors.text}">${label}</text>
    </g>`;
}

/**
 * Render an input component to SVG
 */
function renderInput(component: InputComponent, bounds: LayoutBounds): string {
  const colors = component.disabled ? COLORS.input.disabled : COLORS.input.normal;
  const displayText = component.value || component.placeholder || '';
  const textColor = component.value ? colors.text : colors.placeholder;

  return `
    <g data-component-type="input">
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
            fill="${colors.background}" stroke="${colors.border}" stroke-width="1.5" rx="4"/>
      <text x="${bounds.x + 12}" y="${bounds.y + bounds.height / 2}"
            dominant-baseline="middle"
            font-family="sans-serif" font-size="14" fill="${textColor}">${escapeXml(displayText)}</text>
    </g>`;
}

/**
 * Render a text component to SVG
 */
function renderText(component: TextComponent, bounds: LayoutBounds): string {
  const fontSize = component.fontSize || 14;
  const fontWeight = component.fontWeight || 'normal';
  const color = component.color || '#374151';
  const content = escapeXml(component.content || '');

  return `
    <g data-component-type="text">
      <text x="${bounds.x}" y="${bounds.y + bounds.height / 2}"
            dominant-baseline="middle"
            font-family="sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${color}">${content}</text>
    </g>`;
}

/**
 * Render a title component to SVG (larger, bold text)
 */
function renderTitle(component: TextComponent, bounds: LayoutBounds): string {
  const fontSize = component.fontSize || 24;
  const fontWeight = component.fontWeight || 'bold';
  const color = component.color || '#111827';
  const content = escapeXml(component.content || '');

  return `
    <g data-component-type="title">
      <text x="${bounds.x}" y="${bounds.y + bounds.height / 2}"
            dominant-baseline="middle"
            font-family="sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${color}">${content}</text>
    </g>`;
}

/**
 * Render an avatar component to SVG
 */
function renderAvatar(component: AvatarComponent, bounds: LayoutBounds): string {
  const size = component.size || Math.min(bounds.width, bounds.height);
  const cx = bounds.x + size / 2;
  const cy = bounds.y + size / 2;
  const initials = component.initials || '';

  let content = '';
  if (initials) {
    content = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
                     font-family="sans-serif" font-size="${size * 0.4}" fill="${COLORS.display.avatar.text}">${escapeXml(initials)}</text>`;
  } else {
    // Person silhouette placeholder
    const headR = size * 0.2;
    const bodyR = size * 0.35;
    content = `
      <circle cx="${cx}" cy="${cy - size * 0.1}" r="${headR}" fill="${COLORS.display.avatar.text}"/>
      <ellipse cx="${cx}" cy="${cy + size * 0.25}" rx="${bodyR}" ry="${bodyR * 0.6}" fill="${COLORS.display.avatar.text}"/>`;
  }

  return `
    <g data-component-type="avatar">
      <circle cx="${cx}" cy="${cy}" r="${size / 2}" fill="${COLORS.display.avatar.fill}" stroke="${COLORS.display.avatar.stroke}" stroke-width="1.5"/>
      ${content}
    </g>`;
}

/**
 * Render an image placeholder to SVG
 */
function renderImage(component: ImageComponent, bounds: LayoutBounds): string {
  const alt = component.alt || 'Image';
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  // Mountain and sun icon
  const iconSize = Math.min(bounds.width, bounds.height) * 0.3;
  const sunR = iconSize * 0.2;
  const sunX = cx + iconSize * 0.3;
  const sunY = cy - iconSize * 0.2;

  return `
    <g data-component-type="image">
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
            fill="${COLORS.display.image.fill}" stroke="${COLORS.display.image.stroke}" stroke-width="1.5" rx="4"/>
      <line x1="${bounds.x}" y1="${bounds.y}" x2="${bounds.x + bounds.width}" y2="${bounds.y + bounds.height}"
            stroke="${COLORS.display.image.stroke}" stroke-width="1" stroke-dasharray="4 2"/>
      <line x1="${bounds.x + bounds.width}" y1="${bounds.y}" x2="${bounds.x}" y2="${bounds.y + bounds.height}"
            stroke="${COLORS.display.image.stroke}" stroke-width="1" stroke-dasharray="4 2"/>
      <circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${COLORS.display.image.icon}"/>
      <path d="M ${cx - iconSize * 0.4} ${cy + iconSize * 0.3} L ${cx} ${cy - iconSize * 0.1} L ${cx + iconSize * 0.4} ${cy + iconSize * 0.3} Z"
            fill="${COLORS.display.image.icon}"/>
      <text x="${cx}" y="${bounds.y + bounds.height - 8}" text-anchor="middle"
            font-family="sans-serif" font-size="12" fill="${COLORS.display.image.icon}">${escapeXml(alt)}</text>
    </g>`;
}

/**
 * Render an icon placeholder to SVG
 */
function renderIcon(component: IconComponent, bounds: LayoutBounds): string {
  const size = component.size || Math.min(bounds.width, bounds.height);
  const name = component.name || 'icon';
  const letter = name.charAt(0).toUpperCase();
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  return `
    <g data-component-type="icon">
      <rect x="${bounds.x}" y="${bounds.y}" width="${size}" height="${size}"
            fill="none" stroke="${COLORS.display.icon.fill}" stroke-width="1.5" rx="4"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
            font-family="sans-serif" font-size="${size * 0.5}" fill="${COLORS.display.icon.fill}">${letter}</text>
    </g>`;
}

/**
 * Render an app bar to SVG
 */
function renderAppBar(component: AppBarComponent, bounds: LayoutBounds): string {
  const title = escapeXml(component.title || 'App Bar');
  const leftIcon = component.leftIcon ? component.leftIcon.charAt(0).toUpperCase() : '';
  const rightIcons = component.rightIcons || [];

  let leftIconSvg = '';
  if (leftIcon) {
    leftIconSvg = `<text x="${bounds.x + 16}" y="${bounds.y + bounds.height / 2}" dominant-baseline="middle"
                         font-family="sans-serif" font-size="20" fill="${COLORS.nav.text}">${leftIcon}</text>`;
  }

  let rightIconsSvg = '';
  rightIcons.forEach((icon, i) => {
    const letter = icon.charAt(0).toUpperCase();
    const x = bounds.x + bounds.width - 16 - i * 32;
    rightIconsSvg += `<text x="${x}" y="${bounds.y + bounds.height / 2}" text-anchor="end" dominant-baseline="middle"
                           font-family="sans-serif" font-size="20" fill="${COLORS.nav.text}">${letter}</text>`;
  });

  return `
    <g data-component-type="appbar">
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
            fill="${COLORS.nav.background}" stroke="${COLORS.nav.border}" stroke-width="1.5"/>
      ${leftIconSvg}
      <text x="${bounds.x + bounds.width / 2}" y="${bounds.y + bounds.height / 2}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="sans-serif" font-size="18" font-weight="bold" fill="${COLORS.nav.text}">${title}</text>
      ${rightIconsSvg}
    </g>`;
}

/**
 * Render a bottom nav to SVG
 */
function renderBottomNav(component: BottomNavComponent, bounds: LayoutBounds): string {
  const items = component.items || [];
  const activeIndex = component.activeIndex ?? 0;
  const itemWidth = items.length > 0 ? bounds.width / items.length : bounds.width;

  let itemsSvg = '';
  items.forEach((item, i) => {
    const x = bounds.x + i * itemWidth + itemWidth / 2;
    const isActive = i === activeIndex;
    const color = isActive ? COLORS.nav.active : COLORS.nav.text;
    const icon = item.icon ? item.icon.charAt(0).toUpperCase() : '';

    itemsSvg += `
      <g>
        <text x="${x}" y="${bounds.y + 20}" text-anchor="middle" font-family="sans-serif" font-size="18" fill="${color}">${icon}</text>
        <text x="${x}" y="${bounds.y + 42}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${color}">${escapeXml(item.label)}</text>
      </g>`;
  });

  return `
    <g data-component-type="bottomnav">
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
            fill="${COLORS.nav.background}" stroke="${COLORS.nav.border}" stroke-width="1.5"/>
      ${itemsSvg}
    </g>`;
}

/**
 * Render a nav menu to SVG
 */
function renderNavMenu(component: NavMenuComponent, bounds: LayoutBounds): string {
  const items = component.items || [];
  const isVertical = component.variant !== 'horizontal';
  const itemHeight = isVertical ? 44 : bounds.height;
  const itemWidth = isVertical ? bounds.width : (items.length > 0 ? bounds.width / items.length : bounds.width);

  let itemsSvg = '';
  items.forEach((item, i) => {
    const x = isVertical ? bounds.x : bounds.x + i * itemWidth;
    const y = isVertical ? bounds.y + i * itemHeight : bounds.y;
    const w = isVertical ? bounds.width : itemWidth;
    const h = itemHeight;
    const isActive = item.active;
    const bgColor = isActive ? '#eff6ff' : 'transparent';
    const textColor = isActive ? COLORS.nav.active : COLORS.nav.text;
    const icon = item.icon ? item.icon.charAt(0).toUpperCase() : '';

    if (isVertical) {
      // Vertical layout: left-aligned icon + label
      itemsSvg += `
        <g>
          <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bgColor}"/>
          ${icon ? `<text x="${x + 16}" y="${y + h / 2}" dominant-baseline="middle" font-family="sans-serif" font-size="16" fill="${textColor}">${icon}</text>` : ''}
          <text x="${x + (icon ? 40 : 16)}" y="${y + h / 2}" dominant-baseline="middle" font-family="sans-serif" font-size="14" fill="${textColor}">${escapeXml(item.label)}</text>
        </g>`;
    } else {
      // Horizontal layout: centered icon + label
      const centerX = x + w / 2;
      const activeIndicator = isActive ? `<line x1="${x + 8}" y1="${y + h - 3}" x2="${x + w - 8}" y2="${y + h - 3}" stroke="${COLORS.nav.active}" stroke-width="3"/>` : '';
      itemsSvg += `
        <g>
          ${activeIndicator}
          ${icon ? `<text x="${centerX - 20}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="14" fill="${textColor}">${icon}</text>` : ''}
          <text x="${centerX + (icon ? 10 : 0)}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="14" font-weight="${isActive ? 'bold' : 'normal'}" fill="${textColor}">${escapeXml(item.label)}</text>
        </g>`;
    }
  });

  return `
    <g data-component-type="navmenu">
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
            fill="${COLORS.nav.background}" stroke="${COLORS.nav.border}" stroke-width="1.5"/>
      ${itemsSvg}
    </g>`;
}

/**
 * Render a list to SVG
 */
function renderList(component: ListComponent, bounds: LayoutBounds): string {
  const items = component.items || [];
  const dividers = component.dividers ?? false;
  const itemHeight = items.length > 0 ? bounds.height / items.length : 44;

  let itemsSvg = '';
  items.forEach((item, i) => {
    const y = bounds.y + i * itemHeight;
    const icon = item.icon ? item.icon.charAt(0).toUpperCase() : '';

    itemsSvg += `
      <g>
        ${icon ? `<text x="${bounds.x + 16}" y="${y + itemHeight / 2}" dominant-baseline="middle" font-family="sans-serif" font-size="16" fill="${COLORS.display.list.text}">${icon}</text>` : ''}
        <text x="${bounds.x + (icon ? 48 : 16)}" y="${y + itemHeight / 2}" dominant-baseline="middle" font-family="sans-serif" font-size="14" fill="${COLORS.display.list.text}">${escapeXml(item.label)}</text>
        ${dividers && i < items.length - 1 ? `<line x1="${bounds.x}" y1="${y + itemHeight}" x2="${bounds.x + bounds.width}" y2="${y + itemHeight}" stroke="${COLORS.display.list.border}" stroke-width="1"/>` : ''}
      </g>`;
  });

  return `
    <g data-component-type="list">
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
            fill="${COLORS.display.list.background}" stroke="${COLORS.display.list.border}" stroke-width="1.5" rx="4"/>
      ${itemsSvg}
    </g>`;
}

/**
 * Render a divider to SVG
 */
function renderDivider(component: DividerComponent, bounds: LayoutBounds): string {
  const isVertical = component.orientation === 'vertical';

  if (isVertical) {
    const cx = bounds.x + bounds.width / 2;
    return `
      <g data-component-type="divider">
        <line x1="${cx}" y1="${bounds.y}" x2="${cx}" y2="${bounds.y + bounds.height}"
              stroke="#e5e7eb" stroke-width="1"/>
      </g>`;
  }

  const cy = bounds.y + bounds.height / 2;
  return `
    <g data-component-type="divider">
      <line x1="${bounds.x}" y1="${cy}" x2="${bounds.x + bounds.width}" y2="${cy}"
            stroke="#e5e7eb" stroke-width="1"/>
    </g>`;
}

/**
 * Render a card to SVG
 */
function renderCard(
  component: CardComponent,
  bounds: LayoutBounds,
  renderChildren: (children: WireframeComponent[], bounds: LayoutBounds, isRow: boolean) => string
): string {
  const title = component.title ? escapeXml(component.title) : '';
  const titleHeight = title ? 32 : 0;
  const padding = component.padding ?? 12;

  const contentBounds: LayoutBounds = {
    x: bounds.x + padding,
    y: bounds.y + padding + titleHeight,
    width: bounds.width - padding * 2,
    height: bounds.height - padding * 2 - titleHeight,
  };

  const childrenSvg = component.children ? renderChildren(component.children, contentBounds, false) : '';

  return `
    <g data-component-type="card">
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
            fill="#ffffff" stroke="${COLORS.container.cardBorder}" stroke-width="1.5" rx="8"/>
      ${title ? `<text x="${bounds.x + padding}" y="${bounds.y + padding + 16}" font-family="sans-serif" font-size="16" font-weight="bold" fill="#374151">${title}</text>` : ''}
      ${childrenSvg}
    </g>`;
}

/**
 * Render a column layout to SVG
 */
function renderCol(
  component: ColComponent,
  bounds: LayoutBounds,
  renderChildren: (children: WireframeComponent[], bounds: LayoutBounds, isRow: boolean) => string
): string {
  const childrenSvg = component.children ? renderChildren(component.children, bounds, false) : '';
  return `<g data-component-type="col">${childrenSvg}</g>`;
}

/**
 * Render a row layout to SVG
 */
function renderRow(
  component: RowComponent,
  bounds: LayoutBounds,
  renderChildren: (children: WireframeComponent[], bounds: LayoutBounds, isRow: boolean) => string
): string {
  const childrenSvg = component.children ? renderChildren(component.children, bounds, true) : '';
  return `<g data-component-type="row">${childrenSvg}</g>`;
}

/**
 * Render any component to SVG
 */
function renderComponent(
  component: WireframeComponent,
  bounds: LayoutBounds,
  renderChildrenFn: (children: WireframeComponent[], bounds: LayoutBounds, isRow: boolean) => string
): string {
  switch (component.type) {
    case 'button':
      return renderButton(component, bounds);
    case 'input':
      return renderInput(component, bounds);
    case 'text':
      return renderText(component, bounds);
    case 'title':
      return renderTitle(component, bounds);
    case 'avatar':
      return renderAvatar(component, bounds);
    case 'image':
      return renderImage(component, bounds);
    case 'icon':
      return renderIcon(component, bounds);
    case 'appbar':
      return renderAppBar(component, bounds);
    case 'bottomnav':
      return renderBottomNav(component, bounds);
    case 'navmenu':
      return renderNavMenu(component, bounds);
    case 'list':
      return renderList(component, bounds);
    case 'divider':
      return renderDivider(component, bounds);
    case 'card':
      return renderCard(component, bounds, renderChildrenFn);
    case 'col':
      return renderCol(component, bounds, renderChildrenFn);
    case 'row':
      return renderRow(component, bounds, renderChildrenFn);
    default:
      // Unknown component - render placeholder
      return `
        <g data-component-type="unknown">
          <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
                fill="#f5f5f5" stroke="#999" stroke-dasharray="4 2"/>
          <text x="${bounds.x + bounds.width / 2}" y="${bounds.y + bounds.height / 2}"
                text-anchor="middle" dominant-baseline="middle"
                font-family="sans-serif" font-size="12" fill="#666">Unknown: ${component.type}</text>
        </g>`;
  }
}

/**
 * Render children with layout calculation
 *
 * Implements flexbox-style layout:
 * - flex: 0 = fixed size (use bounds.width/height)
 * - flex: 1+ = proportional flexible sizing (default)
 * - align = cross-axis alignment (start/center/end)
 */
function renderChildrenWithLayout(
  children: WireframeComponent[],
  containerBounds: LayoutBounds,
  isRow: boolean,
  gap: number = 0,
  padding: number = 0
): string {
  if (!children || children.length === 0) return '';

  const contentBounds: LayoutBounds = {
    x: containerBounds.x + padding,
    y: containerBounds.y + padding,
    width: containerBounds.width - padding * 2,
    height: containerBounds.height - padding * 2,
  };

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
  let svg = '';

  for (const child of children) {
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

    svg += renderComponent(child, childBounds, (c, b, r) =>
      renderChildrenWithLayout(c, b, r, (child as any).gap ?? 0, (child as any).padding ?? 0)
    );

    offset += mainSize + gap;
  }

  return svg;
}

/**
 * Render a screen to SVG
 */
function renderScreen(screen: ScreenComponent, bounds: LayoutBounds, labelY: number): string {
  const backgroundColor = screen.backgroundColor || '#ffffff';

  const childrenSvg = renderChildrenWithLayout(screen.children, bounds, false);

  return `
    <g data-screen-id="${screen.id}">
      <!-- Screen label -->
      <text x="${bounds.x}" y="${labelY}" font-family="sans-serif" font-size="14" font-weight="bold" fill="#374151">${escapeXml(screen.name)}</text>

      <!-- Screen background -->
      <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"
            fill="${backgroundColor}" stroke="${COLORS.container.screenBorder}" stroke-width="2" rx="4"/>

      <!-- Screen content -->
      ${childrenSvg}
    </g>`;
}

/**
 * Render a wireframe to SVG string
 */
export function renderWireframeToSVG(wireframe: WireframeRoot, scale: number = 1): string {
  const viewport = wireframe.viewport || 'mobile';
  const direction = wireframe.direction || 'LR';
  const screens = wireframe.screens || [];

  const dimensions = getViewportDimensions(viewport, direction, screens.length);
  const screenWidth = VIEWPORT_WIDTHS[viewport];
  const screenHeight = BASE_HEIGHT;
  const screenWidthWithPadding = screenWidth + SCREEN_PADDING * 2;
  const screenHeightWithPadding = screenHeight + SCREEN_PADDING * 2 + LABEL_SPACE;

  const svgWidth = dimensions.width * scale;
  const svgHeight = dimensions.height * scale;

  let screensSvg = '';
  screens.forEach((screen, index) => {
    const x = direction === 'LR'
      ? index * (screenWidthWithPadding + SCREEN_GAP)
      : 0;
    const y = direction === 'TD'
      ? index * (screenHeightWithPadding + SCREEN_GAP)
      : 0;

    const bounds: LayoutBounds = {
      x: x + SCREEN_PADDING,
      y: y + SCREEN_PADDING + LABEL_SPACE,
      width: screenWidth,
      height: screenHeight,
    };

    const labelY = y + LABEL_SPACE / 2 + 8;
    screensSvg += renderScreen(screen, bounds, labelY);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${dimensions.width} ${dimensions.height}"
     width="${svgWidth}" height="${svgHeight}"
     style="background-color: #f8f9fa;">
  ${screensSvg}
</svg>`;
}

/**
 * Wireframe renderer class for the API
 */
export class WireframeRenderer {
  renderToSVG(wireframe: WireframeRoot, scale: number = 1): string {
    return renderWireframeToSVG(wireframe, scale);
  }
}
