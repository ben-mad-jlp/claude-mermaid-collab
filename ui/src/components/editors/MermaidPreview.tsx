/**
 * MermaidPreview Component
 *
 * Renders Mermaid diagrams with:
 * - Theme support (light/dark mode)
 * - Error handling for invalid syntax
 * - Responsive sizing
 * - Loading states
 * - Zoom via Ctrl+scroll or toolbar
 * - Pan via middle-click drag
 */

import React, { useEffect, useRef, useState, useCallback, useId, useImperativeHandle } from 'react';
import mermaid from 'mermaid';
import { useTheme } from '@/hooks/useTheme';
import { extractNodeId, extractEdgeInfo } from '@/lib/diagramUtils';
import { initializeMermaid } from '@/lib/mermaidConfig';

export interface MermaidPreviewProps {
  /** The Mermaid diagram syntax content to render */
  content: string;
  /** Optional CSS class name for the container */
  className?: string;
  /** Optional callback when rendering is complete */
  onRender?: () => void;
  /** Optional callback when rendering fails */
  onError?: (error: Error) => void;
  /** Current zoom level (percentage, default 100) */
  zoomLevel?: number;
  /** Callback for zoom in (triggered by scroll wheel) */
  onZoomIn?: () => void;
  /** Callback for zoom out (triggered by scroll wheel) */
  onZoomOut?: () => void;
  /** Callback for setting zoom to specific level */
  onSetZoom?: (level: number) => void;
  /** Optional callback to receive SVG container ref when mounted */
  onContainerRef?: (ref: HTMLDivElement | null) => void;
  /** Whether to enable edit mode for visual diagram editing */
  editMode?: boolean;
  /** Callback when a node is clicked in edit mode */
  onNodeClick?: (nodeId: string) => void;
  /** Callback when an edge is clicked in edit mode */
  onEdgeClick?: (edgeId: string) => void;
  /** Callback when node is clicked with click position */
  onNodeClickWithPosition?: (nodeId: string, event: MouseEvent) => void;
  /** Callback when edge is clicked with click position */
  onEdgeClickWithPosition?: (source: string, target: string, event: MouseEvent) => void;
  /** Ref to expose imperative methods */
  previewRef?: React.RefObject<MermaidPreviewRef>;
}

/** Imperative methods exposed by MermaidPreview */
export interface MermaidPreviewRef {
  /** Center the diagram (reset pan and zoom to 100%) */
  center: () => void;
  /** Fit the diagram to fill the container */
  fitToView: () => void;
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
  zoomLevel = 100,
  onZoomIn,
  onZoomOut,
  onSetZoom,
  onContainerRef,
  editMode = false,
  onNodeClick,
  onEdgeClick,
  onNodeClickWithPosition,
  onEdgeClickWithPosition,
  previewRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const uniqueId = useId().replace(/:/g, '-');
  const [state, setState] = useState<MermaidPreviewState>({
    isLoading: true,
    error: null,
  });
  const { theme } = useTheme();

  // Pan state for middle-click drag
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  // Center the diagram (reset pan and zoom to 100%)
  const center = useCallback(() => {
    setPanOffset({ x: 0, y: 0 });
    onSetZoom?.(100);
  }, [onSetZoom]);

  // Fit the diagram to fill the container
  const fitToView = useCallback(() => {
    if (!wrapperRef.current || !containerRef.current) return;

    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;

    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();

    // Get actual SVG dimensions (at current zoom)
    const currentZoom = zoomLevel / 100;
    const svgWidth = svgRect.width / currentZoom;
    const svgHeight = svgRect.height / currentZoom;

    if (svgWidth === 0 || svgHeight === 0) return;

    // Calculate zoom to fit with some padding
    const padding = 32; // 16px on each side
    const availableWidth = wrapperRect.width - padding;
    const availableHeight = wrapperRect.height - padding;

    const scaleX = availableWidth / svgWidth;
    const scaleY = availableHeight / svgHeight;
    const scale = Math.min(scaleX, scaleY);

    // Clamp to reasonable zoom levels (25% - 400%)
    const newZoom = Math.max(25, Math.min(400, Math.round(scale * 100)));

    // Reset pan and set new zoom
    setPanOffset({ x: 0, y: 0 });
    onSetZoom?.(newZoom);
  }, [zoomLevel, onSetZoom]);

  // Expose methods via ref
  useImperativeHandle(previewRef, () => ({
    center,
    fitToView,
  }), [center, fitToView]);

  // Notify parent of container ref when mounted
  useEffect(() => {
    if (containerRef.current) {
      onContainerRef?.(containerRef.current);
    }

    return () => {
      // Call with null on unmount
      onContainerRef?.(null);
    };
  }, [onContainerRef]);

  // Keep refs in sync with state/props
  useEffect(() => {
    panOffsetRef.current = panOffset;
  }, [panOffset]);

  // Refs for zoom callbacks to avoid effect re-runs
  const onZoomInRef = useRef(onZoomIn);
  const onZoomOutRef = useRef(onZoomOut);
  useEffect(() => {
    onZoomInRef.current = onZoomIn;
    onZoomOutRef.current = onZoomOut;
  }, [onZoomIn, onZoomOut]);

  // Handle scroll wheel zoom - attached to outer container so it works even during loading
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const handleWheel = (e: WheelEvent) => {
      // Ctrl+scroll or Cmd+scroll for zoom
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY < 0) {
          onZoomInRef.current?.();
        } else {
          onZoomOutRef.current?.();
        }
      }
    };

    outer.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => outer.removeEventListener('wheel', handleWheel, { capture: true });
  }, []);

  // Handle middle-click or shift+left-click pan
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Middle mouse button (button === 1) OR shift+left click (button === 0 && shiftKey)
      if (e.button === 1 || (e.button === 0 && (e as any).shiftKey)) {
        e.preventDefault();
        isPanningRef.current = true;
        setIsPanning(true);
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          offsetX: panOffsetRef.current.x,
          offsetY: panOffsetRef.current.y,
        };
        wrapper.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return;
      const deltaX = e.clientX - panStartRef.current.x;
      const deltaY = e.clientY - panStartRef.current.y;
      setPanOffset({
        x: panStartRef.current.offsetX + deltaX,
        y: panStartRef.current.offsetY + deltaY,
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      // End panning on any mouse button release if we were panning
      if (isPanningRef.current) {
        isPanningRef.current = false;
        setIsPanning(false);
        // Restore cursor based on whether shift is still held
        if ((e as any).shiftKey) {
          wrapper.style.cursor = 'grab';
        } else {
          wrapper.style.cursor = '';
        }
      }
    };

    // Prevent context menu on middle click
    const handleContextMenu = (e: MouseEvent) => {
      if (isPanningRef.current) {
        e.preventDefault();
      }
    };

    // Handle shift key to show grab cursor
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !isPanningRef.current) {
        wrapper.style.cursor = 'grab';
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !isPanningRef.current) {
        wrapper.style.cursor = '';
      }
    };

    wrapper.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    wrapper.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      wrapper.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      wrapper.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Handle diagram clicks in edit mode (node/edge selection)
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !editMode) return;

    const handleDiagramClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Walk up DOM tree to find element with data-id attribute and class 'node' or 'edgePath'
      let current: HTMLElement | null = target;
      let foundElement: HTMLElement | null = null;
      let elementType: 'node' | 'edge' | null = null;

      while (current && current !== wrapper) {
        const dataId = current.getAttribute('data-id');

        // Check if this is a node element
        if (
          dataId &&
          (current.classList.contains('node') ||
            current.classList.contains('nodes'))
        ) {
          foundElement = current;
          elementType = 'node';
          break;
        }

        // Check if this is an edge element
        if (
          dataId &&
          (current.classList.contains('edgePath') ||
            current.classList.contains('edges'))
        ) {
          foundElement = current;
          elementType = 'edge';
          break;
        }

        current = current.parentElement;
      }

      // Trigger appropriate callback if element found
      if (foundElement && elementType) {
        const targetId = foundElement.getAttribute('data-id');
        if (targetId) {
          if (elementType === 'node' && onNodeClick) {
            onNodeClick(targetId);
          } else if (elementType === 'edge' && onEdgeClick) {
            onEdgeClick(targetId);
          }
        }
      }
    };

    wrapper.addEventListener('click', handleDiagramClick);

    return () => {
      wrapper.removeEventListener('click', handleDiagramClick);
    };
  }, [editMode, onNodeClick, onEdgeClick]);

  // Handle diagram clicks with position for context menus (independent of editMode)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!onNodeClickWithPosition && !onEdgeClickWithPosition) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element;

      // Check if it's a node using diagramUtils
      const nodeId = extractNodeId(target);
      if (nodeId && onNodeClickWithPosition) {
        onNodeClickWithPosition(nodeId, e);
        return;
      }

      // Check if it's an edge using diagramUtils
      const edgeInfo = extractEdgeInfo(target);
      if (edgeInfo && onEdgeClickWithPosition) {
        onEdgeClickWithPosition(edgeInfo.source, edgeInfo.target, e);
        return;
      }
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [onNodeClickWithPosition, onEdgeClickWithPosition]);

  // Track if mermaid is initialized
  const [mermaidReady, setMermaidReady] = useState(false);

  // Initialize mermaid with theme - pass content to detect custom init directives
  useEffect(() => {
    initializeMermaid(theme as 'light' | 'dark', content).then(() => {
      setMermaidReady(true);
    });
  }, [theme, content]);

  // Render the diagram
  const renderDiagram = useCallback(async () => {
    if (!content?.trim()) {
      setState({ isLoading: false, error: null });
      return;
    }

    try {
      setState({ isLoading: true, error: null });

      // Generate unique render ID with timestamp to avoid caching issues
      const renderId = `mermaid-${uniqueId}-${Date.now()}`;
      const { svg } = await mermaid.render(renderId, content);

      // Check ref still exists after async operation
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
      }

      setState({ isLoading: false, error: null });
      onRender?.();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to render diagram';
      setState({ isLoading: false, error: errorMessage });
      onError?.(error instanceof Error ? error : new Error(errorMessage));
    }
  }, [content, uniqueId, onRender, onError]);

  // Re-render when content, theme changes, or mermaid becomes ready
  useEffect(() => {
    if (mermaidReady) {
      renderDiagram();
    }
  }, [renderDiagram, mermaidReady]);

  // Reset pan when content changes
  useEffect(() => {
    setPanOffset({ x: 0, y: 0 });
  }, [content]);

  return (
    <div
      ref={outerRef}
      className={`mermaid-preview-container relative w-full h-full flex flex-col ${theme === 'dark' ? 'dark' : ''} ${className}`}
      data-testid="mermaid-preview"
    >
      {/* Loading indicator */}
      {state.isLoading && (
        <div
          className="flex items-center justify-center flex-1 bg-gray-50 dark:bg-gray-800 rounded-lg"
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

      {/* Diagram container - always rendered but hidden during loading/error */}
      <div
        ref={wrapperRef}
        className={`mermaid-diagram-wrapper overflow-auto bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700 flex-1 ${
          state.isLoading || state.error || !content?.trim() ? 'hidden' : ''
        } ${theme === 'dark' ? 'dark' : ''}`}
        style={{ cursor: isPanning ? 'grabbing' : 'default' }}
        data-testid="mermaid-diagram"
      >
        <div
          ref={containerRef}
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel / 100})`,
            transformOrigin: 'top left',
            minWidth: 'fit-content',
            minHeight: 'fit-content',
          }}
        />
      </div>

      {/* Empty state */}
      {!state.isLoading && !state.error && !content?.trim() && (
        <div className="flex items-center justify-center flex-1 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Enter Mermaid syntax to preview diagram
          </p>
        </div>
      )}
    </div>
  );
};

export default MermaidPreview;
