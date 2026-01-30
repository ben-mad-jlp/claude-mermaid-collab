/**
 * WireframePage Component
 *
 * Displays wireframes using the useWireframe hook for fetching and live updates.
 * Provides viewport switching (mobile/tablet/desktop) and renders wireframe
 * content via WireframeRenderer (placeholder until Wave 4).
 */

import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useWireframe } from '@/hooks/useWireframe';
import { useTheme } from '@/hooks/useTheme';
import type { Viewport, WireframeRoot } from '@/types/wireframe';

/**
 * Viewport widths for different device sizes
 */
const VIEWPORT_WIDTHS: Record<Viewport, number> = {
  mobile: 375,
  tablet: 768,
  desktop: 1200,
};

/**
 * Loading spinner component
 */
function LoadingSpinner() {
  return (
    <div
      data-testid="wireframe-loading"
      className="flex items-center justify-center h-full"
    >
      <div
        role="status"
        className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"
        aria-label="Loading wireframe"
      >
        <span className="sr-only">Loading...</span>
      </div>
    </div>
  );
}

/**
 * Error display component
 */
function ErrorDisplay({ error }: { error: string }) {
  return (
    <div
      data-testid="wireframe-error"
      className="flex flex-col items-center justify-center h-full p-8"
    >
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2">
          Error Loading Wireframe
        </h2>
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    </div>
  );
}

/**
 * Not found display component
 */
function NotFoundDisplay() {
  return (
    <div
      data-testid="wireframe-not-found"
      className="flex flex-col items-center justify-center h-full p-8"
    >
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 max-w-md text-center">
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Wireframe not found
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          The requested wireframe could not be found.
        </p>
      </div>
    </div>
  );
}

/**
 * Viewport selector component
 */
function ViewportSelector({
  currentViewport,
  onViewportChange,
}: {
  currentViewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
}) {
  const viewports: Viewport[] = ['mobile', 'tablet', 'desktop'];

  return (
    <div
      data-testid="viewport-selector"
      className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1"
      role="group"
      aria-label="Viewport selector"
    >
      {viewports.map((viewport) => (
        <button
          key={viewport}
          onClick={() => onViewportChange(viewport)}
          aria-pressed={currentViewport === viewport}
          className={`
            px-4 py-2 rounded-md text-sm font-medium transition-colors
            ${
              currentViewport === viewport
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }
          `}
        >
          {viewport.charAt(0).toUpperCase() + viewport.slice(1)}
        </button>
      ))}
    </div>
  );
}

/**
 * Wireframe placeholder component
 * Displays JSON until WireframeRenderer is available in Wave 4
 */
function WireframePlaceholder({
  wireframe,
  viewport,
}: {
  wireframe: unknown;
  viewport: Viewport;
}) {
  return (
    <div
      data-testid="wireframe-placeholder"
      className="flex-1 overflow-auto p-4"
      style={{ maxWidth: VIEWPORT_WIDTHS[viewport] }}
    >
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Wireframe Preview (Placeholder)
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          WireframeRenderer will be connected in Wave 4
        </p>
        <pre className="text-xs bg-white dark:bg-gray-900 p-4 rounded border border-gray-200 dark:border-gray-700 overflow-auto max-h-96">
          <code>{JSON.stringify(wireframe, null, 2)}</code>
        </pre>
      </div>
    </div>
  );
}

/**
 * WireframePage component
 *
 * Main page for viewing wireframes. Extracts wireframe parameters from URL,
 * fetches wireframe data via useWireframe hook, and displays appropriate
 * states (loading, error, not found, or wireframe content).
 */
export function WireframePage() {
  const { project = '', session = '', id = '' } = useParams<{
    project: string;
    session: string;
    id: string;
  }>();
  const { theme } = useTheme();
  const { wireframe, loading, error } = useWireframe(project, session, id);

  // Local viewport state for preview switching
  const [selectedViewport, setSelectedViewport] = useState<Viewport>('mobile');

  // Determine the effective viewport from wireframe data or local selection
  const effectiveViewport =
    (wireframe as WireframeRoot | null)?.viewport || selectedViewport;

  // Render content based on state
  const renderContent = () => {
    if (loading) {
      return <LoadingSpinner />;
    }

    if (error) {
      return <ErrorDisplay error={error} />;
    }

    if (!wireframe) {
      return <NotFoundDisplay />;
    }

    return (
      <div
        data-testid="wireframe-content"
        className="flex flex-col h-full"
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Wireframe Preview
            </h1>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {id}
            </span>
          </div>
          <ViewportSelector
            currentViewport={selectedViewport}
            onViewportChange={setSelectedViewport}
          />
        </div>

        {/* Wireframe display area */}
        <div className="flex-1 flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-8 overflow-auto">
          <WireframePlaceholder
            wireframe={wireframe}
            viewport={selectedViewport}
          />
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="wireframe-page"
      className={`h-screen flex flex-col ${
        theme === 'dark' ? 'dark bg-gray-900' : 'bg-white'
      }`}
    >
      <main role="main" className="flex-1 overflow-hidden">
        {renderContent()}
      </main>
    </div>
  );
}

export default WireframePage;
