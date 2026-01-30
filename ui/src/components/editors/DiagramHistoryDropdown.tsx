/**
 * DiagramHistoryDropdown Component
 *
 * A dropdown button showing diagram change history.
 * Features:
 * - Shows list of historical versions with relative timestamps
 * - Click outside to close
 * - Loading state while fetching version content
 * - Disabled when no history available
 */

import React, { useState, useRef, useEffect } from 'react';
import { useDiagramHistory } from '@/hooks/useDiagramHistory';

/**
 * Props for the DiagramHistoryDropdown component
 */
export interface DiagramHistoryDropdownProps {
  /** Diagram ID to show history for */
  diagramId: string;
  /** Callback when user selects a historical version */
  onVersionSelect: (timestamp: string, content: string) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Formats ISO timestamp to a readable timestamp string
 * Examples: "9:45:30 AM", "Yesterday 9:45 PM", "Mon 9:45 PM", "Jan 30, 9:45 AM"
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

  if (isToday) {
    return timeStr;
  }
  if (isYesterday) {
    return `Yesterday ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }

  // Within last 7 days - show day name
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays < 7) {
    const dayName = date.toLocaleDateString([], { weekday: 'short' });
    return `${dayName} ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }

  // Older - show date
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

export const DiagramHistoryDropdown: React.FC<DiagramHistoryDropdownProps> = ({
  diagramId,
  onVersionSelect,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loadingTimestamp, setLoadingTimestamp] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { history, isLoading, getVersionAt } = useDiagramHistory(diagramId);

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
                : formatTimestamp(change.timestamp)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

DiagramHistoryDropdown.displayName = 'DiagramHistoryDropdown';

export default DiagramHistoryDropdown;
