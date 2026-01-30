/**
 * Wireframe TypeScript type definitions for rough.js rendering
 */

/**
 * Viewport type represents supported device viewport sizes
 */
export type Viewport = 'mobile' | 'tablet' | 'desktop';

/**
 * Direction type represents layout direction
 */
export type Direction = 'LR' | 'TD';

/**
 * ButtonVariant type represents different button visual styles
 */
export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'danger' | 'success' | 'disabled';

/**
 * LayoutBounds interface defines rectangular position and size
 */
export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * BaseComponent interface provides common properties for all components
 */
export interface BaseComponent {
  id: string;
  type: string;
  bounds: LayoutBounds;
  label?: string;
  flex?: number;                              // 0 = fixed size (use bounds), 1+ = proportional flex
  align?: 'start' | 'center' | 'end';         // Cross-axis alignment
}

/**
 * ScreenComponent interface represents a wireframe screen/page
 */
export interface ScreenComponent extends BaseComponent {
  type: 'screen';
  name: string;
  backgroundColor?: string;
  children: WireframeComponent[];
}

/**
 * ColComponent interface represents a vertical layout column
 */
export interface ColComponent extends BaseComponent {
  type: 'col';
  gap?: number;
  padding?: number;
  children: WireframeComponent[];
}

/**
 * RowComponent interface represents a horizontal layout row
 */
export interface RowComponent extends BaseComponent {
  type: 'row';
  gap?: number;
  padding?: number;
  children: WireframeComponent[];
}

/**
 * ButtonComponent interface represents an interactive button
 */
export interface ButtonComponent extends BaseComponent {
  type: 'button';
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
}

/**
 * InputComponent interface represents a text input field
 */
export interface InputComponent extends BaseComponent {
  type: 'input';
  placeholder?: string;
  value?: string;
  inputType?: string;
  disabled?: boolean;
}

/**
 * TextComponent interface represents static text content
 */
export interface TextComponent extends BaseComponent {
  type: 'text';
  content: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
}

/**
 * CardComponent interface represents a card container with visual styling
 */
export interface CardComponent extends BaseComponent {
  type: 'card';
  title?: string;
  gap?: number;
  padding?: number;
  children: WireframeComponent[];
}

/**
 * NavItem interface represents a navigation menu item
 */
export interface NavItem {
  label: string;
  icon?: string;
  active?: boolean;
}

/**
 * AppBarComponent interface represents a top app bar
 */
export interface AppBarComponent extends BaseComponent {
  type: 'appbar';
  title?: string;
  leftIcon?: string;
  rightIcons?: string[];
}

/**
 * BottomNavComponent interface represents a bottom navigation bar
 */
export interface BottomNavComponent extends BaseComponent {
  type: 'bottomnav';
  items: NavItem[];
  activeIndex?: number;
}

/**
 * NavMenuComponent interface represents a side navigation menu
 */
export interface NavMenuComponent extends BaseComponent {
  type: 'navmenu';
  items: NavItem[];
  variant?: 'horizontal' | 'vertical';
}

/**
 * AvatarComponent interface represents a circular avatar placeholder
 */
export interface AvatarComponent extends BaseComponent {
  type: 'avatar';
  size?: number;
  initials?: string;
}

/**
 * ImageComponent interface represents an image placeholder
 */
export interface ImageComponent extends BaseComponent {
  type: 'image';
  alt?: string;
  aspectRatio?: string;
}

/**
 * IconComponent interface represents a simple icon placeholder
 */
export interface IconComponent extends BaseComponent {
  type: 'icon';
  name?: string;
  size?: number;
}

/**
 * ListItemData interface represents a single list item's data
 */
export interface ListItemData {
  id: string;
  label: string;
  icon?: string;
}

/**
 * ListComponent interface represents a list with items
 */
export interface ListComponent extends BaseComponent {
  type: 'list';
  items: ListItemData[];
  dividers?: boolean;
}

/**
 * DividerComponent interface represents a horizontal or vertical divider line
 */
export interface DividerComponent extends BaseComponent {
  type: 'divider';
  orientation?: 'horizontal' | 'vertical';
}

/**
 * RenderContext interface provides context for rough.js rendering
 */
export interface RenderContext {
  canvas: HTMLCanvasElement;
  rc: any; // rough.js RoughCanvas object
  viewport: Viewport;
  scale: number;
  theme?: string;
}

/**
 * WireframeRoot interface is the top-level wireframe structure
 */
export interface WireframeRoot {
  viewport: Viewport;
  direction: Direction;
  screens: ScreenComponent[];
}

/**
 * WireframeComponent union type represents any renderable wireframe component
 */
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
