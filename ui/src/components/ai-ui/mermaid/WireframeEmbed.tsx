/**
 * WireframeEmbed Component
 *
 * Renders inline Mermaid wireframe previews with:
 * - Responsive sizing
 * - Theme support (light/dark mode)
 * - Error handling for invalid syntax
 * - Loading states
 * - Compact display suitable for embedding in larger layouts
 *
 * Supports Mermaid wireframe syntax for UI mockup display.
 */

import React, { useEffect, useRef, useState, useCallback, useId } from 'react';
import mermaid from 'mermaid';
import { useTheme } from '@/hooks/useTheme';

export interface WireframeEmbedProps {
  /** The Mermaid wireframe syntax content to render */
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

export interface WireframeEmbedState {
  isLoading: boolean;
  error: string | null;
}

/**
 * WireframeEmbed component for inline wireframe preview display
 *
 * Renders Mermaid wireframe syntax into visual mockups with theme support,
 * error handling, and responsive sizing. Designed for embedding
 * wireframe previews within larger layouts or content areas.
 *
 * @example
 * ```tsx
 * <WireframeEmbed
 *   content="wireframe
 *     Screen 1
 *     [ Header ]
 *     [ Content Area ]
 *     [ Footer ]"
 *   height="400px"
 *   onRender={() => console.log('rendered')}
 *   onError={(err) => console.error(err)}
 * />
 * ```
 */
export const WireframeEmbed: React.FC<WireframeEmbedProps> = ({
  content,
  className = '',
  onRender,
  onError,
  height,
}) => {
  const uniqueId = useId();
  const mermaidId = `wireframe-${uniqueId.replace(/:/g, '')}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [refReady, setRefReady] = useState(false);
  const [state, setState] = useState<WireframeEmbedState>({
    isLoading: true,
    error: null,
  });
  const { theme } = useTheme();

  // Callback ref to detect when container is mounted
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (node) {
      setRefReady(true);
    }
  }, []);

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

  // Render the wireframe
  const renderWireframe = useCallback(async () => {
    if (!containerRef.current || !content?.trim()) {
      setState({ isLoading: false, error: null });
      return;
    }

    try {
      setState({ isLoading: true, error: null });

      // Clear previous content
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }

      // Validate and render with unique ID
      const { svg } = await mermaid.render(mermaidId, content);

      // Check ref still exists after async operation
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
      }

      setState({ isLoading: false, error: null });
      onRender?.();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to render wireframe';
      setState({ isLoading: false, error: errorMessage });
      onError?.(error instanceof Error ? error : new Error(errorMessage));
    }
  }, [content, mermaidId, onRender, onError]);

  // Re-render when content, theme, or ref changes
  useEffect(() => {
    if (refReady) {
      renderWireframe();
    }
  }, [renderWireframe, refReady]);

  const heightStyle = height
    ? typeof height === 'string'
      ? height
      : `${height}px`
    : undefined;

  return (
    <div
      className={`wireframe-embed-container relative w-full ${theme === 'dark' ? 'dark' : ''} ${className}`}
      data-testid="wireframe-embed"
      style={heightStyle ? { height: heightStyle } : undefined}
    >
      {/* Loading indicator */}
      {state.isLoading && (
        <div
          className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-800 rounded-lg"
          data-testid="wireframe-embed-loading"
        >
          <div className="text-gray-500 dark:text-gray-400 text-sm">
            Rendering wireframe...
          </div>
        </div>
      )}

      {/* Error message */}
      {state.error && (
        <div
          className="p-3 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg h-full flex flex-col justify-center"
          data-testid="wireframe-embed-error"
        >
          <p className="text-red-700 dark:text-red-200 text-xs font-medium">
            Error rendering wireframe
          </p>
          <p className="text-red-600 dark:text-red-300 text-xs mt-1 font-mono truncate">
            {state.error}
          </p>
        </div>
      )}

      {/* Wireframe container - always render but hide when loading/error */}
      <div
        ref={setContainerRef}
        className={`wireframe-wrapper overflow-auto bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700 h-full ${theme === 'dark' ? 'dark' : ''} ${state.isLoading || state.error || !content?.trim() ? 'hidden' : ''}`}
        data-testid="wireframe-embed-diagram"
      />

      {/* Empty state */}
      {!state.isLoading && !state.error && !content?.trim() && (
        <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400 text-xs">
            No wireframe content
          </p>
        </div>
      )}
    </div>
  );
};

export default WireframeEmbed;
