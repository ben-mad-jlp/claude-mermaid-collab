/**
 * DiagramHistoryPreview Component
 *
 * Side-by-side preview showing current diagram vs historical version.
 * Features:
 * - Two MermaidPreview components side-by-side
 * - Clear labels for "Current" and "Viewing: {timestamp}"
 * - "Revert to this version" and "Back" buttons
 */

import React from 'react';
import { MermaidPreview } from '@/components/editors/MermaidPreview';

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

export interface DiagramHistoryPreviewProps {
  /** Current diagram content */
  currentContent: string;
  /** Historical diagram content being viewed */
  historicalContent: string;
  /** Timestamp of the historical version */
  historicalTimestamp: string;
  /** Callback when user clicks "Revert to this version" */
  onRevert: () => void;
  /** Callback when user clicks "Back" to exit preview mode */
  onClose: () => void;
}

export const DiagramHistoryPreview: React.FC<DiagramHistoryPreviewProps> = ({
  currentContent,
  historicalContent,
  historicalTimestamp,
  onRevert,
  onClose,
}) => {
  return (
    <div className="flex flex-col h-full" data-testid="diagram-history-preview">
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
            <MermaidPreview content={historicalContent} className="h-full" />
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
            <MermaidPreview content={currentContent} className="h-full" />
          </div>
        </div>
      </div>
    </div>
  );
};

DiagramHistoryPreview.displayName = 'DiagramHistoryPreview';

export default DiagramHistoryPreview;
