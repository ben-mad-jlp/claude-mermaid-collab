import React, { useState } from 'react';
import DiffViewer from 'react-diff-viewer-continued';

export interface DiffViewProps {
  before: string;
  after: string;
  fileName?: string;
  mode?: 'unified' | 'split';
  contextLines?: number;
  language?: string;
  collapseLargeLines?: boolean;
  ariaLabel?: string;
}

export const DiffView: React.FC<DiffViewProps> = ({
  before,
  after,
  fileName,
  mode = 'split',
  contextLines = 3,
  language = 'text',
  collapseLargeLines = true,
  ariaLabel,
}) => {
  const [currentMode, setCurrentMode] = useState<'unified' | 'split'>(mode);

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const hasChanges = before !== after;

  if (!hasChanges) {
    return (
      <div
        className="p-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800"
        role="region"
        aria-label={ariaLabel || 'Diff view (no changes)'}
      >
        <div className="text-center text-gray-600 dark:text-gray-400">
          <p>No changes detected</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden"
      role="region"
      aria-label={ariaLabel || `Diff view for ${fileName || 'file'}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-600">
        <div className="flex items-center gap-3">
          {fileName && (
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {fileName}
            </span>
          )}
          {language && (
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              {language}
            </span>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-2 bg-gray-200 dark:bg-gray-700 rounded-md p-1">
          <button
            onClick={() => setCurrentMode('split')}
            className={`px-3 py-1 text-sm font-medium rounded transition-colors duration-200 ${
              currentMode === 'split'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
            aria-pressed={currentMode === 'split'}
            aria-label="Split view"
          >
            Split
          </button>
          <button
            onClick={() => setCurrentMode('unified')}
            className={`px-3 py-1 text-sm font-medium rounded transition-colors duration-200 ${
              currentMode === 'unified'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
            aria-pressed={currentMode === 'unified'}
            aria-label="Unified view"
          >
            Unified
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="overflow-auto max-h-96 bg-white dark:bg-gray-900">
        <DiffViewer
          oldValue={before}
          newValue={after}
          splitView={currentMode === 'split'}
          hideLineNumbers={false}
          showDiffOnly={true}
          useDarkTheme={isDark}
          leftTitle="Before"
          rightTitle="After"
        />
      </div>

      {/* Summary */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-green-500 rounded"></span>
            Additions
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-red-500 rounded"></span>
            Removals
          </span>
        </div>
      </div>
    </div>
  );
};

DiffView.displayName = 'DiffView';
