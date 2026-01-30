/**
 * WireframeHistoryDropdown Component
 *
 * A dropdown button showing wireframe change history.
 * Features:
 * - Shows list of historical versions with relative timestamps
 * - Click outside to close
 * - Loading state while fetching version content
 * - Disabled when no history available
 */

import React, { useState, useRef, useEffect } from 'react';
import { useWireframeHistory } from '@/hooks/useWireframeHistory';

/**
 * Props for the WireframeHistoryDropdown component
 */
export interface WireframeHistoryDropdownProps {
  /** Wireframe ID to show history for */
  wireframeId: string;
  /** Callback when user selects a historical version */
  onVersionSelect: (timestamp: string, content: string) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Formats ISO timestamp to relative time string
 * Examples: "just now", "5m ago", "2h ago", "Yesterday", "3d ago", or date for older
 */
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 2) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export const WireframeHistoryDropdown: React.FC<WireframeHistoryDropdownProps> = ({
  wireframeId,
  onVersionSelect,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loadingTimestamp, setLoadingTimestamp] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { history, isLoading, getVersionAt } = useWireframeHistory(wireframeId);

  const hasHistory = history !== null && history.changes.length > 0;
  const versionCount = history?.changes.length ?? 0;

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleItemClick = async (timestamp: string) => {
    setLoadingTimestamp(timestamp);
    const content = await getVersionAt(timestamp);
    setLoadingTimestamp(null);

    if (content !== null) {
      onVersionSelect(timestamp, content);
      setIsOpen(false);
    }
  };

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={!hasHistory || isLoading}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
        title={hasHistory ? `View history (${versionCount} versions)` : 'No history available'}
      >
        <svg
          className="w-4 h-4"
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
        <span>History</span>
        {hasHistory && (
          <span className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-1 rounded text-xs">
            {versionCount}
          </span>
        )}
      </button>

      {isOpen && hasHistory && (
        <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-64 overflow-auto">
          <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            Select version to preview
          </div>
          {/* Show changes in reverse order (newest first) */}
          {[...history.changes].reverse().map((change) => (
            <button
              key={change.timestamp}
              onClick={() => handleItemClick(change.timestamp)}
              disabled={loadingTimestamp === change.timestamp}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              {loadingTimestamp === change.timestamp
                ? 'Loading...'
                : formatRelativeTime(change.timestamp)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

WireframeHistoryDropdown.displayName = 'WireframeHistoryDropdown';

export default WireframeHistoryDropdown;
