/**
 * Wireframe Module - JSON-based wireframe rendering with rough.js
 *
 * This module provides a complete wireframe rendering system that:
 * - Accepts JSON wireframe definitions via MCP tools
 * - Renders components using rough.js for hand-drawn styling
 * - Supports flexbox-style layout calculation
 * - Provides all component types: text, button, input, containers, navigation, display
 */

// Main renderer
export { WireframeRenderer, type WireframeRendererProps } from './WireframeRenderer';

// Layout utilities
export {
  calculateLayout,
  getLayoutDirection,
  getViewportDimensions,
  type LayoutResult,
  type LayoutDirection,
} from './layout';

// Component registry and renderers
export * from './components';

// Types re-exported from types module
export type {
  WireframeRoot,
  WireframeComponent,
  ScreenComponent,
  ColComponent,
  RowComponent,
  CardComponent,
  ButtonComponent,
  InputComponent,
  TextComponent,
  AppBarComponent,
  BottomNavComponent,
  NavMenuComponent,
  AvatarComponent,
  ImageComponent,
  IconComponent,
  ListComponent,
  LayoutBounds,
  Viewport,
  Direction,
  ButtonVariant,
} from '../../types/wireframe';
