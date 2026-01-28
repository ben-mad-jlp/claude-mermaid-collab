/**
 * HistoryToolbar Component
 *
 * Integrated history navigation toolbar with prev/next arrows and dropdown.
 * Designed to sit next to undo/redo in the primary editor toolbar.
 *
 * Features:
 * - Previous/Next arrows to step through history chronologically
 * - Dropdown to jump to specific versions
 * - Visual indicator of current position in history
 * - Seamless integration with document editing
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSession } from '@/hooks/useSession';
import type { ChangeEntry, DocumentHistory } from '@/types/history';

export interface HistoryToolbarProps {
  /** Document ID to fetch history for */
  documentId: string;
  /** Current document content */
  currentContent: string;
  /** Callback when a version is selected for viewing */
  onVersionSelect: (timestamp: string, content: string, previousContent?: string) => void;
  /** Optional class name */
  className?: string;
}

/**
 * Formats ISO timestamp to relative time string
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

export const HistoryToolbar: React.FC<HistoryToolbarProps> = ({
  documentId,
  currentContent,
  onVersionSelect,
  className = '',
}) => {
  const [history, setHistory] = useState<DocumentHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 means current version
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [loadingVersion, setLoadingVersion] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { currentSession } = useSession();
  const project = currentSession?.project ?? null;
  const session = currentSession?.name ?? null;

  // Fetch history when component mounts or documentId changes
  const fetchHistory = useCallback(async () => {
    if (!documentId || !project || !session) {
      setHistory(null);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({ project, session });
      const response = await fetch(`/api/document/${documentId}/history?${params}`);
      if (response.ok) {
        const data = await response.json();
        setHistory(data);
        setCurrentIndex(-1); // Reset to current version
      } else if (response.status === 404) {
        setHistory(null);
      }
    } catch {
      setHistory(null);
    } finally {
      setIsLoading(false);
    }
  }, [documentId, project, session]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  // Get version content at specific timestamp
  const getVersionAt = useCallback(
    async (timestamp: string): Promise<string | null> => {
      if (!documentId || !project || !session) return null;

      try {
        const params = new URLSearchParams({ project, session, timestamp });
        const response = await fetch(`/api/document/${documentId}/version?${params}`);
        if (response.ok) {
          const data = await response.json();
          return data.content;
        }
      } catch {
        // Ignore errors
      }
      return null;
    },
    [documentId, project, session]
  );

  const changes = history?.changes ?? [];
  // We need at least 2 history entries to show any historical versions
  // (index 0 is skipped because it's represented by "Current")
  const hasHistory = changes.length > 1;
  const totalVersions = changes.length; // Most recent is "Current", so effective versions = changes.length

  // Navigate to previous version (older)
  // Skip index 0 since "Current" represents the most recent history entry
  const handlePrev = async () => {
    if (!hasHistory || currentIndex >= changes.length - 1) return;

    // From Current (-1), go to index 1 (skip index 0)
    // From index N, go to index N+1
    const newIndex = currentIndex === -1 ? 1 : currentIndex + 1;
    const change = changes[changes.length - 1 - newIndex];
    if (change) {
      setLoadingVersion(change.timestamp);
      const content = await getVersionAt(change.timestamp);

      // Also fetch the version before this one (if exists) for vs-previous comparison
      let previousContent: string | undefined;
      const previousIdx = changes.length - 1 - newIndex - 1;
      if (previousIdx >= 0) {
        const previousChange = changes[previousIdx];
        previousContent = await getVersionAt(previousChange.timestamp) ?? undefined;
      }

      setLoadingVersion(null);
      if (content !== null) {
        setCurrentIndex(newIndex);
        onVersionSelect(change.timestamp, content, previousContent);
      }
    }
  };

  // Navigate to next version (newer)
  // Skip index 0 - from index 1, go directly to Current (-1)
  const handleNext = async () => {
    if (!hasHistory || currentIndex <= -1) return;

    if (currentIndex === 1) {
      // From index 1, go directly to Current (skip index 0)
      setCurrentIndex(-1);
      onVersionSelect('current', currentContent);
    } else {
      const newIndex = currentIndex - 1;
      const change = changes[changes.length - 1 - newIndex];
      if (change) {
        setLoadingVersion(change.timestamp);
        const content = await getVersionAt(change.timestamp);

        // Also fetch the version before this one (if exists) for vs-previous comparison
        let previousContent: string | undefined;
        const previousIdx = changes.length - 1 - newIndex - 1;
        if (previousIdx >= 0) {
          const previousChange = changes[previousIdx];
          previousContent = await getVersionAt(previousChange.timestamp) ?? undefined;
        }

        setLoadingVersion(null);
        if (content !== null) {
          setCurrentIndex(newIndex);
          onVersionSelect(change.timestamp, content, previousContent);
        }
      }
    }
  };

  // Handle dropdown item click
  const handleDropdownSelect = async (index: number) => {
    if (index === -1) {
      // Current version
      setCurrentIndex(-1);
      onVersionSelect('current', currentContent);
      setIsDropdownOpen(false);
      return;
    }

    const change = changes[changes.length - 1 - index];
    if (change) {
      setLoadingVersion(change.timestamp);
      const content = await getVersionAt(change.timestamp);

      // Also fetch the version before this one (if exists) for vs-previous comparison
      let previousContent: string | undefined;
      const previousIdx = changes.length - 1 - index - 1;
      if (previousIdx >= 0) {
        const previousChange = changes[previousIdx];
        previousContent = await getVersionAt(previousChange.timestamp) ?? undefined;
      }

      setLoadingVersion(null);
      if (content !== null) {
        setCurrentIndex(index);
        onVersionSelect(change.timestamp, content, previousContent);
        setIsDropdownOpen(false);
      }
    }
  };

  const hasSessionContext = project !== null && session !== null;
  const canGoPrev = hasSessionContext && hasHistory && currentIndex < changes.length - 1;
  const canGoNext = hasSessionContext && hasHistory && currentIndex > -1;
  const isLoadingAny = isLoading || loadingVersion !== null;
  const isDisabled = !hasSessionContext || !hasHistory || isLoadingAny;

  // Get the timestamp of the most recent change (for "Current" display)
  const mostRecentChangeTimestamp = changes.length > 0
    ? changes[changes.length - 1].timestamp
    : null;

  // Calculate display label - show relative time for current version too
  const displayLabel =
    currentIndex === -1
      ? (mostRecentChangeTimestamp ? `Current (${formatRelativeTime(mostRecentChangeTimestamp)})` : 'Current')
      : formatRelativeTime(changes[changes.length - 1 - currentIndex]?.timestamp ?? '');

  return (
    <div
      ref={dropdownRef}
      className={`relative flex items-center gap-1 ${className}`}
      data-testid="history-toolbar"
    >
      {/* Previous (older) button */}
      <button
        onClick={handlePrev}
        disabled={!canGoPrev || isLoadingAny}
        className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title="Previous version (older)"
        data-testid="history-prev-btn"
      >
        <svg
          className="w-4 h-4 text-gray-600 dark:text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      {/* Dropdown button */}
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        disabled={isDisabled}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors min-w-[80px] justify-center"
        title={!hasSessionContext ? 'No session' : hasHistory ? `${totalVersions} versions` : 'No history'}
        data-testid="history-dropdown-btn"
      >
        {isLoadingAny ? (
          <span className="animate-pulse">Loading...</span>
        ) : (
          <>
            <span>{displayLabel}</span>
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </>
        )}
      </button>

      {/* Next (newer) button */}
      <button
        onClick={handleNext}
        disabled={!canGoNext || isLoadingAny}
        className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title="Next version (newer)"
        data-testid="history-next-btn"
      >
        <svg
          className="w-4 h-4 text-gray-600 dark:text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isDropdownOpen && hasSessionContext && hasHistory && (
        <div
          className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-64 overflow-auto"
          data-testid="history-dropdown-menu"
        >
          {/* Current version */}
          <button
            onClick={() => handleDropdownSelect(-1)}
            className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
              currentIndex === -1
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            <span>Current</span>
            {mostRecentChangeTimestamp && (
              <span className="ml-2 text-gray-400 dark:text-gray-500 text-xs">
                {formatRelativeTime(mostRecentChangeTimestamp)}
              </span>
            )}
          </button>

          {/* Historical versions (newest first, skip most recent since it's represented by "Current") */}
          {changes.length > 1 && (
            <>
              {/* Divider */}
              <div className="border-t border-gray-200 dark:border-gray-700" />

              {changes
                .slice()
                .reverse()
                .slice(1) // Skip the most recent change (already shown as "Current")
                .map((change, idx) => (
                  <button
                    key={change.timestamp}
                    onClick={() => handleDropdownSelect(idx + 1)} // +1 to account for skipped item
                    disabled={loadingVersion === change.timestamp}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      currentIndex === idx + 1
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {loadingVersion === change.timestamp
                      ? 'Loading...'
                      : formatRelativeTime(change.timestamp)}
                  </button>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

HistoryToolbar.displayName = 'HistoryToolbar';

export default HistoryToolbar;
