/**
 * AI-UI Types
 *
 * Re-export of AI-UI component types from the parent project.
 * This file provides type definitions for all AI-UI components.
 */

// Import from parent ai-ui.ts
// These are the type definitions used for AI-UI component rendering

export interface CommonProps {
  className?: string;
  style?: Record<string, any>;
  hidden?: boolean;
}

export interface CardProps extends CommonProps {
  title?: string;
  subtitle?: string;
  footer?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  borderColor?: string;
  backgroundColor?: string;
  elevation?: number;
}

export interface SectionProps extends CommonProps {
  heading?: string;
  description?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  divider?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
}

export interface ColumnsProps extends CommonProps {
  columns: number;
  gap?: number;
  responsive?: boolean;
  breakpoints?: {
    mobile?: number;
    tablet?: number;
    desktop?: number;
  };
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
}

export interface AccordionProps extends CommonProps {
  sections: Array<{
    id: string;
    title: string;
    content: UIComponent;
    expanded?: boolean;
  }>;
  allowMultiple?: boolean;
  variant?: 'default' | 'flush' | 'outlined';
}

export interface AlertProps extends CommonProps {
  type: 'success' | 'warning' | 'error' | 'info';
  title?: string;
  message?: string;
  dismissible?: boolean;
  icon?: string;
  actions?: Array<{
    id: string;
    label: string;
  }>;
  persistent?: boolean;
}

export interface UIComponent {
  type: string;
  props: Record<string, any>;
  children?: UIComponent[];
  actions?: UIAction[];
}

export interface UIAction {
  id: string;
  label: string;
  primary?: boolean;
  destructive?: boolean;
  alignment?: 'left' | 'center' | 'right';
}
