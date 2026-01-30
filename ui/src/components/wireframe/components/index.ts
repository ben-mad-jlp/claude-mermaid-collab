/**
 * Wireframe Component Registry
 *
 * Central export point for all wireframe components rendered with rough.js.
 * Each component follows the pattern:
 * - Uses React with canvas refs
 * - Renders using rough.js for hand-drawn style
 * - Accepts component data and bounds props
 */

// Basic components
export { TextRenderer, TitleRenderer, type TextRendererProps } from './Text';
export { Button, type ButtonProps } from './Button';
export { Input, type InputProps } from './Input';

// Container components
export {
  ScreenRenderer,
  RowRenderer,
  ColRenderer,
  CardRenderer,
  type ContainerRendererProps,
} from './Container';

// Navigation components
export { AppBar, BottomNav, NavMenu } from './Navigation';
export type {
  AppBarProps,
  BottomNavProps,
  NavMenuProps,
} from './Navigation';

// Display components
export { Avatar, Image, Icon, List, Divider } from './Display';
export type {
  AvatarProps,
  ImageProps,
  IconProps,
  ListProps,
  DividerProps,
} from './Display';

/**
 * Component type to component mapping for dynamic rendering
 */
import { TextRenderer, TitleRenderer } from './Text';
import { Button } from './Button';
import { Input } from './Input';
import { ScreenRenderer, RowRenderer, ColRenderer, CardRenderer } from './Container';
import { AppBar, BottomNav, NavMenu } from './Navigation';
import { Avatar, Image, Icon, List, Divider } from './Display';

import type { LayoutBounds } from '../../../types/wireframe';

/**
 * Simple component renderer (component + bounds only)
 */
export type SimpleComponentRenderer<T = any> = React.FC<{
  component: T;
  bounds: LayoutBounds;
}>;

/**
 * Container component renderer (includes renderChildren)
 */
export type ContainerComponentRenderer<T = any> = React.FC<{
  component: T;
  bounds: LayoutBounds;
  renderChildren: (children: any[], bounds: LayoutBounds) => React.ReactNode;
}>;

/**
 * Registry of simple wireframe components by type (no children)
 */
export const simpleComponentRegistry: Record<string, SimpleComponentRenderer> = {
  // Text
  text: TextRenderer as SimpleComponentRenderer,
  title: TitleRenderer as SimpleComponentRenderer,

  // Basic
  button: Button as SimpleComponentRenderer,
  input: Input as SimpleComponentRenderer,

  // Navigation
  appbar: AppBar as SimpleComponentRenderer,
  bottomnav: BottomNav as SimpleComponentRenderer,
  navmenu: NavMenu as SimpleComponentRenderer,

  // Display
  avatar: Avatar as SimpleComponentRenderer,
  image: Image as SimpleComponentRenderer,
  icon: Icon as SimpleComponentRenderer,
  list: List as SimpleComponentRenderer,
  divider: Divider as SimpleComponentRenderer,
};

/**
 * Registry of container wireframe components by type (with children)
 */
export const containerComponentRegistry: Record<string, ContainerComponentRenderer> = {
  screen: ScreenRenderer as ContainerComponentRenderer,
  row: RowRenderer as ContainerComponentRenderer,
  col: ColRenderer as ContainerComponentRenderer,
  card: CardRenderer as ContainerComponentRenderer,
};

/**
 * Get a simple component renderer by type
 */
export function getSimpleComponent(type: string): SimpleComponentRenderer | undefined {
  return simpleComponentRegistry[type.toLowerCase()];
}

/**
 * Get a container component renderer by type
 */
export function getContainerComponent(type: string): ContainerComponentRenderer | undefined {
  return containerComponentRegistry[type.toLowerCase()];
}

/**
 * Check if a component type is a container (has children)
 */
export function isContainerComponent(type: string): boolean {
  return type.toLowerCase() in containerComponentRegistry;
}

/**
 * Check if a component type is registered (simple or container)
 */
export function isRegisteredComponent(type: string): boolean {
  const lowerType = type.toLowerCase();
  return lowerType in simpleComponentRegistry || lowerType in containerComponentRegistry;
}

/**
 * Get all registered component types
 */
export function getRegisteredTypes(): string[] {
  return [
    ...Object.keys(simpleComponentRegistry),
    ...Object.keys(containerComponentRegistry),
  ];
}
