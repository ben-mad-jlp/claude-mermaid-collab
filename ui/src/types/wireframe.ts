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
  | ButtonComponent
  | InputComponent
  | TextComponent;
