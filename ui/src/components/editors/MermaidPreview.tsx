/**
 * MermaidPreview Component
 *
 * Renders Mermaid diagrams with:
 * - Theme support (light/dark mode)
 * - Error handling for invalid syntax
 * - Responsive sizing
 * - Loading states
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { useTheme } from '@/hooks/useTheme';

export interface MermaidPreviewProps {
  /** The Mermaid diagram syntax content to render */
  content: string;
  /** Optional CSS class name for the container */
  className?: string;
  /** Optional callback when rendering is complete */
  onRender?: () => void;
  /** Optional callback when rendering fails */
  onError?: (error: Error) => void;
}

export interface MermaidPreviewState {
  isLoading: boolean;
  error: string | null;
}

/**
 * Mermaid diagram preview component
 *
 * Renders Mermaid diagram syntax into SVG with theme support
 * and error handling for invalid syntax.
 *
 * @example
 * ```tsx
 * <MermaidPreview
 *   content="graph TD; A-->B; B-->C"
 *   onRender={() => console.log('rendered')}
 *   onError={(err) => console.error(err)}
 * />
 * ```
 */
export const MermaidPreview: React.FC<MermaidPreviewProps> = ({
  content,
  className = '',
  onRender,
  onError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<MermaidPreviewState>({
    isLoading: true,
    error: null,
  });
  const { theme } = useTheme();

  // Initialize mermaid with theme
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
    });
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

  return (
    <div
      className={`mermaid-preview-container relative w-full ${className}`}
      data-testid="mermaid-preview"
    >
      {/* Loading indicator */}
      {state.isLoading && (
        <div
          className="flex items-center justify-center h-48 bg-gray-50 dark:bg-gray-800 rounded-lg"
          data-testid="mermaid-loading"
        >
          <div className="text-gray-500 dark:text-gray-400">Rendering...</div>
        </div>
      )}

      {/* Error message */}
      {state.error && (
        <div
          className="p-4 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg"
          data-testid="mermaid-error"
        >
          <p className="text-red-700 dark:text-red-200 text-sm font-medium">
            Error rendering diagram
          </p>
          <p className="text-red-600 dark:text-red-300 text-xs mt-1 font-mono">
            {state.error}
          </p>
        </div>
      )}

      {/* Diagram container */}
      {!state.isLoading && !state.error && content.trim() && (
        <div
          ref={containerRef}
          className="mermaid-diagram-wrapper overflow-auto bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
          data-testid="mermaid-diagram"
        />
      )}

      {/* Empty state */}
      {!state.isLoading && !state.error && !content.trim() && (
        <div className="flex items-center justify-center h-48 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Enter Mermaid syntax to preview diagram
          </p>
        </div>
      )}
    </div>
  );
};

export default MermaidPreview;
