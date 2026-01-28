/**
 * HistoryDiffSettingsDropdown Component
 *
 * Dropdown for controlling how document history diffs are displayed.
 * Provides options for:
 * - View mode: inline (in-document) vs side-by-side
 * - Compare mode: selected vs current vs selected vs previous version
 */

import React, { useState, useRef, useEffect } from 'react';

export interface HistoryDiffSettingsDropdownProps {
  /** Current view mode setting */
  viewMode: 'inline' | 'side-by-side';
  /** Current compare mode setting */
  compareMode: 'vs-current' | 'vs-previous';
  /** Callback when settings change */
  onSettingsChange: (viewMode: 'inline' | 'side-by-side', compareMode: 'vs-current' | 'vs-previous') => void;
  /** Whether there is a previous version available for comparison */
  hasPreviousVersion: boolean;
}

export const HistoryDiffSettingsDropdown: React.FC<HistoryDiffSettingsDropdownProps> = ({
  viewMode,
  compareMode,
  onSettingsChange,
  hasPreviousVersion,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click outside to close dropdown
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

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleViewModeChange = (newViewMode: 'inline' | 'side-by-side') => {
    onSettingsChange(newViewMode, compareMode);
  };

  const handleCompareModeChange = (newCompareMode: 'vs-current' | 'vs-previous') => {
    onSettingsChange(viewMode, newCompareMode);
  };

  return (
    <div ref={dropdownRef} className="relative" data-testid="history-diff-settings">
      {/* Settings Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 text-sm font-medium bg-amber-100 dark:bg-amber-800/40 hover:bg-amber-200 dark:hover:bg-amber-700/50 text-amber-800 dark:text-amber-200 rounded transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid="history-diff-settings-btn"
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
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <span>Diff Settings</span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
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
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 overflow-hidden"
          role="menu"
          data-testid="history-diff-settings-menu"
        >
          {/* View Mode Section */}
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              View Mode
            </div>
            <div className="space-y-1">
              <button
                onClick={() => handleViewModeChange('inline')}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors ${
                  viewMode === 'inline'
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                role="menuitemradio"
                aria-checked={viewMode === 'inline'}
                data-testid="view-mode-inline"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                <span>Inline Diff</span>
                {viewMode === 'inline' && (
                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => handleViewModeChange('side-by-side')}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors ${
                  viewMode === 'side-by-side'
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                role="menuitemradio"
                aria-checked={viewMode === 'side-by-side'}
                data-testid="view-mode-side-by-side"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
                <span>Side by Side</span>
                {viewMode === 'side-by-side' && (
                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Compare Mode Section */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Compare
            </div>
            <div className="space-y-1">
              <button
                onClick={() => handleCompareModeChange('vs-current')}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors ${
                  compareMode === 'vs-current'
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                role="menuitemradio"
                aria-checked={compareMode === 'vs-current'}
                data-testid="compare-mode-vs-current"
              >
                <span>Selected vs Current</span>
                {compareMode === 'vs-current' && (
                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => handleCompareModeChange('vs-previous')}
                disabled={!hasPreviousVersion}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors ${
                  !hasPreviousVersion
                    ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                    : compareMode === 'vs-previous'
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                role="menuitemradio"
                aria-checked={compareMode === 'vs-previous'}
                aria-disabled={!hasPreviousVersion}
                data-testid="compare-mode-vs-previous"
              >
                <span>Selected vs Previous</span>
                {!hasPreviousVersion && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">(N/A)</span>
                )}
                {hasPreviousVersion && compareMode === 'vs-previous' && (
                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

HistoryDiffSettingsDropdown.displayName = 'HistoryDiffSettingsDropdown';

export default HistoryDiffSettingsDropdown;
