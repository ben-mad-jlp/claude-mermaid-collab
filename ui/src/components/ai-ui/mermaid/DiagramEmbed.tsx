/**
 * DiagramEmbed Component
 *
 * Renders inline Mermaid diagrams with:
 * - Responsive sizing
 * - Theme support (light/dark mode)
 * - Error handling for invalid syntax
 * - Loading states
 * - Compact display suitable for embedding in larger layouts
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { useTheme } from '@/hooks/useTheme';

export interface DiagramEmbedProps {
  /** The Mermaid diagram syntax content to render */
  content: string;
  /** Optional CSS class name for the container */
  className?: string;
  /** Optional callback when rendering is complete */
  onRender?: () => void;
  /** Optional callback when rendering fails */
  onError?: (error: Error) => void;
  /** Optional custom height (default: auto with max-height) */
  height?: string | number;
}

export interface DiagramEmbedState {
  isLoading: boolean;
  error: string | null;
}

/**
 * DiagramEmbed component for inline diagram display
 *
 * Renders Mermaid diagram syntax into SVG with theme support,
 * error handling, and responsive sizing. Designed for embedding
 * within larger layouts or content areas.
 *
 * @example
 * ```tsx
 * <DiagramEmbed
 *   content="graph TD; A-->B; B-->C"
 *   height="300px"
 *   onRender={() => console.log('rendered')}
 *   onError={(err) => console.error(err)}
 * />
 * ```
 */
export const DiagramEmbed: React.FC<DiagramEmbedProps> = ({
  content,
  className = '',
  onRender,
  onError,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<DiagramEmbedState>({
    isLoading: true,
    error: null,
  });
  const { theme } = useTheme();

  // Initialize mermaid with theme
  useEffect(() => {
    const config = {
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
    } as any;

    // Apply dark mode theme variables for better contrast
    if (theme === 'dark') {
      config.themeVariables = {
        primaryColor: '#4a9eff',
        primaryTextColor: '#ffffff',
        primaryBorderColor: '#3a7bd5',
        lineColor: '#888888',
        secondaryColor: '#2d5a8c',
        tertiaryColor: '#1e3a5f',
        background: '#1a1a2e',
        mainBkg: '#1a1a2e',
        nodeBorder: '#4a9eff',
        clusterBkg: '#2d3748',
        titleColor: '#ffffff',
        edgeLabelBackground: '#1a1a2e',
      };
    }

    mermaid.initialize(config);
  }, [theme]);

  // Render the diagram
  const renderDiagram = useCallback(async () => {
    if (!containerRef.current || !content.trim()) {
      setState({ isLoading: false, error: null });
      return;
    }

    try {
      setState({ isLoading: true, error: null });

      // Clear previous content
      containerRef.current.innerHTML = '';

      // Validate and render
      const { svg } = await mermaid.render('mermaid-diagram', content);
      containerRef.current.innerHTML = svg;

      setState({ isLoading: false, error: null });
      onRender?.();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to render diagram';
      setState({ isLoading: false, error: errorMessage });
      onError?.(error instanceof Error ? error : new Error(errorMessage));
    }
  }, [content, onRender, onError]);

  // Re-render when content or theme changes
  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  const heightStyle = height
    ? typeof height === 'string'
      ? height
      : `${height}px`
    : undefined;

  return (
    <div
      className={`diagram-embed-container relative w-full ${theme === 'dark' ? 'dark' : ''} ${className}`}
      data-testid="diagram-embed"
      style={heightStyle ? { height: heightStyle } : undefined}
    >
      {/* Loading indicator */}
      {state.isLoading && (
        <div
          className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-800 rounded-lg"
          data-testid="diagram-embed-loading"
        >
          <div className="text-gray-500 dark:text-gray-400 text-sm">
            Rendering diagram...
          </div>
        </div>
      )}

      {/* Error message */}
      {state.error && (
        <div
          className="p-3 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg h-full flex flex-col justify-center"
          data-testid="diagram-embed-error"
        >
          <p className="text-red-700 dark:text-red-200 text-xs font-medium">
            Error rendering diagram
          </p>
          <p className="text-red-600 dark:text-red-300 text-xs mt-1 font-mono truncate">
            {state.error}
          </p>
        </div>
      )}

      {/* Diagram container */}
      {!state.isLoading && !state.error && content.trim() && (
        <div
          ref={containerRef}
          className={`diagram-wrapper overflow-auto bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700 h-full ${theme === 'dark' ? 'dark' : ''}`}
          data-testid="diagram-embed-diagram"
        />
      )}

      {/* Empty state */}
      {!state.isLoading && !state.error && !content.trim() && (
        <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400 text-xs">
            No diagram content
          </p>
        </div>
      )}
    </div>
  );
};

export default DiagramEmbed;
