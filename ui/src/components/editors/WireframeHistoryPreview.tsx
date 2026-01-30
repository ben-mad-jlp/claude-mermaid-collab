/**
 * WireframeHistoryPreview Component
 *
 * Side-by-side preview showing current wireframe vs historical version.
 * Features:
 * - Two WireframeRenderer components side-by-side
 * - Clear labels for "Current" and "Viewing: {timestamp}"
 * - "Revert to this version" and "Back" buttons
 */

import React, { useMemo } from 'react';
import { WireframeRenderer } from '@/components/wireframe/WireframeRenderer';
import type { WireframeRoot } from '@/types/wireframe';

/**
 * Formats ISO timestamp to human-readable format
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface WireframeHistoryPreviewProps {
  /** Current wireframe content (JSON string) */
  currentContent: string;
  /** Historical wireframe content being viewed (JSON string) */
  historicalContent: string;
  /** Timestamp of the historical version */
  historicalTimestamp: string;
  /** Callback when user clicks "Revert to this version" */
  onRevert: () => void;
  /** Callback when user clicks "Back" to exit preview mode */
  onClose: () => void;
}

export const WireframeHistoryPreview: React.FC<WireframeHistoryPreviewProps> = ({
  currentContent,
  historicalContent,
  historicalTimestamp,
  onRevert,
  onClose,
}) => {
  // Parse wireframe JSON content
  const parsedCurrent = useMemo((): WireframeRoot | null => {
    try {
      const parsed = JSON.parse(currentContent);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed as WireframeRoot;
    } catch {
      return null;
    }
  }, [currentContent]);

  const parsedHistorical = useMemo((): WireframeRoot | null => {
    try {
      const parsed = JSON.parse(historicalContent);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed as WireframeRoot;
    } catch {
      return null;
    }
  }, [historicalContent]);

  const renderWireframe = (wireframe: WireframeRoot | null, label: string) => {
    if (!wireframe) {
      return (
        <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <p className="mb-2">Invalid wireframe JSON</p>
            <p className="text-sm">Check the syntax and try again</p>
          </div>
        </div>
      );
    }

    return <WireframeRenderer wireframe={wireframe} scale={0.8} className="min-h-full" />;
  };

  return (
    <div className="flex flex-col h-full" data-testid="wireframe-history-preview">
      {/* Header with actions */}
      <div className="flex items-center justify-between px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-yellow-600 dark:text-yellow-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Viewing historical version from {formatTimestamp(historicalTimestamp)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRevert}
            className="px-3 py-1.5 text-sm font-medium bg-yellow-600 hover:bg-yellow-700 text-white rounded transition-colors"
          >
            Revert to this version
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors"
          >
            Back
          </button>
        </div>
      </div>

      {/* Side-by-side preview */}
      <div className="flex-1 flex min-h-0">
        {/* Historical version (left) */}
        <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700">
          <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Historical ({formatTimestamp(historicalTimestamp)})
            </span>
          </div>
          <div className="flex-1 min-h-0 p-4 overflow-auto bg-gray-50 dark:bg-gray-900">
            {renderWireframe(parsedHistorical, 'historical')}
          </div>
        </div>

        {/* Current version (right) */}
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Current
            </span>
          </div>
          <div className="flex-1 min-h-0 p-4 overflow-auto bg-gray-50 dark:bg-gray-900">
            {renderWireframe(parsedCurrent, 'current')}
          </div>
        </div>
      </div>
    </div>
  );
};

WireframeHistoryPreview.displayName = 'WireframeHistoryPreview';

export default WireframeHistoryPreview;
