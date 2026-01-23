/**
 * AI-UI Recursive Renderer
 *
 * Takes JSON UI definitions and recursively renders them using
 * the registered AI-UI components. Handles:
 * - Component lookup and validation
 * - Recursive rendering of nested structures
 * - Props passing to all 22 components
 * - Action callback handling
 * - Error handling and fallback rendering
 * - Type-safe rendering with proper prop validation
 */

import React, { useCallback } from 'react';
import type { UIComponent, UIAction } from '@/types/ai-ui';
import { getComponent, validateComponent } from './registry';

/**
 * Callback function for handling component actions
 */
export type ActionCallback = (
  actionId: string,
  payload?: any
) => void | Promise<void>;

/**
 * Props for the recursive renderer
 */
export interface RendererProps {
  component: UIComponent;
  onAction?: ActionCallback;
  componentProps?: Record<string, any>;
  className?: string;
}

/**
 * Error fallback component
 */
const ErrorFallback: React.FC<{ error: Error; componentName: string }> = ({
  error,
  componentName,
}) => (
  <div
    className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg"
    role="alert"
  >
    <h4 className="font-semibold text-red-900 dark:text-red-200 mb-2">
      Error rendering component: {componentName}
    </h4>
    <p className="text-sm text-red-700 dark:text-red-300">{error.message}</p>
  </div>
);

/**
 * Fallback component for unknown types
 */
const UnknownComponentFallback: React.FC<{ type: string }> = ({ type }) => (
  <div
    className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 rounded-lg"
    role="alert"
  >
    <p className="text-sm text-amber-700 dark:text-amber-300">
      Unknown component type: <code className="font-mono">{type}</code>
    </p>
  </div>
);

/**
 * Recursive UI renderer component
 * Renders JSON UI definitions using registered AI-UI components
 */
export const AIUIRenderer: React.FC<RendererProps> = ({
  component,
  onAction,
  componentProps = {},
  className = '',
}) => {
  const handleAction = useCallback(
    async (actionId: string, payload?: any) => {
      if (onAction) {
        try {
          await onAction(actionId, payload);
        } catch (error) {
          console.error('Error handling action:', error);
        }
      }
    },
    [onAction]
  );

  // Validate component input
  if (!component || typeof component !== 'object') {
    return null;
  }

  const { type, props = {}, children = [] } = component;

  // Validate component is registered
  if (!type) {
    return null;
  }

  // Get the component from registry
  let ComponentType: React.ComponentType<any>;
  try {
    validateComponent(type);
    const CompType = getComponent(type);
    if (!CompType) {
      return <UnknownComponentFallback type={type} />;
    }
    ComponentType = CompType;
  } catch (error) {
    return <UnknownComponentFallback type={type} />;
  }

  try {
    // Render child components recursively
    const renderedChildren = children.length > 0
      ? children.map((child, index) => (
          <AIUIRenderer
            key={index}
            component={child}
            onAction={handleAction}
            componentProps={componentProps}
          />
        ))
      : undefined;

    // Merge props with component-specific overrides
    const mergedProps = {
      ...props,
      ...componentProps,
      className: [props.className, componentProps.className, className]
        .filter(Boolean)
        .join(' '),
    };

    // Pass onAction callback if component supports it
    const propsWithCallback = {
      ...mergedProps,
      onAction: onAction ? handleAction : undefined,
    };

    // Remove undefined onAction prop if no callback provided
    if (!onAction) {
      delete propsWithCallback.onAction;
    }

    // Render the component with children
    return (
      <ComponentType {...propsWithCallback}>
        {renderedChildren}
      </ComponentType>
    );
  } catch (error) {
    console.error(`Error rendering component ${type}:`, error);
    return (
      <ErrorFallback
        error={error instanceof Error ? error : new Error(String(error))}
        componentName={type}
      />
    );
  }
};

AIUIRenderer.displayName = 'AIUIRenderer';

/**
 * Hook for rendering AI-UI components with action handling
 */
export function useAIUIRenderer() {
  const renderComponent = useCallback(
    (
      component: UIComponent,
      onAction?: ActionCallback,
      componentProps?: Record<string, any>
    ) => {
      return (
        <AIUIRenderer
          component={component}
          onAction={onAction}
          componentProps={componentProps}
        />
      );
    },
    []
  );

  return { renderComponent };
}

/**
 * Render multiple UI components
 */
export const renderComponents = (
  components: UIComponent[],
  onAction?: ActionCallback,
  componentProps?: Record<string, any>
): React.ReactNode[] => {
  return components.map((component, index) => (
    <AIUIRenderer
      key={index}
      component={component}
      onAction={onAction}
      componentProps={componentProps}
    />
  ));
};

/**
 * High-order component to wrap renderer with action handling
 */
export function withAIUIRenderer(
  WrappedComponent: React.ComponentType<any>,
  onAction?: ActionCallback
) {
  return function WithAIUIRendererComponent(props: any) {
    return (
      <AIUIRenderer
        component={props.uiComponent}
        onAction={onAction}
        componentProps={props}
      />
    );
  };
}

export default AIUIRenderer;
