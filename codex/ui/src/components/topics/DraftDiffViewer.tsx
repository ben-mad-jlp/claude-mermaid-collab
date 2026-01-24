/**
 * DraftDiffViewer Component
 *
 * Side-by-side diff viewer for comparing current and draft content.
 * Highlights additions (green) and deletions (red).
 */

import React, { useMemo } from 'react';

export interface DraftDiffViewerProps {
  /** Current (existing) content */
  current: string;
  /** Draft (proposed) content */
  draft: string;
  /** Language hint for display */
  language?: string;
  /** Optional additional class name */
  className?: string;
}

/**
 * Line diff status
 */
type DiffLineStatus = 'unchanged' | 'added' | 'removed' | 'modified';

/**
 * Diff line structure
 */
interface DiffLine {
  lineNumber: number | null;
  content: string;
  status: DiffLineStatus;
}

/**
 * Simple line-by-line diff algorithm
 * For production, consider using a proper diff library like diff-match-patch
 */
function computeDiff(
  current: string,
  draft: string
): { currentLines: DiffLine[]; draftLines: DiffLine[] } {
  const currentLinesRaw = current.split('\n');
  const draftLinesRaw = draft.split('\n');

  // Build a set of trimmed lines for quick lookup
  const currentSet = new Set(currentLinesRaw.map((l) => l.trim()));
  const draftSet = new Set(draftLinesRaw.map((l) => l.trim()));

  // Process current lines
  const currentLines: DiffLine[] = currentLinesRaw.map((line, index) => {
    const trimmed = line.trim();
    let status: DiffLineStatus = 'unchanged';

    if (trimmed && !draftSet.has(trimmed)) {
      status = 'removed';
    }

    return {
      lineNumber: index + 1,
      content: line,
      status,
    };
  });

  // Process draft lines
  const draftLines: DiffLine[] = draftLinesRaw.map((line, index) => {
    const trimmed = line.trim();
    let status: DiffLineStatus = 'unchanged';

    if (trimmed && !currentSet.has(trimmed)) {
      status = 'added';
    }

    return {
      lineNumber: index + 1,
      content: line,
      status,
    };
  });

  return { currentLines, draftLines };
}

/**
 * Get background color class based on line status
 */
function getLineBackgroundClass(status: DiffLineStatus): string {
  switch (status) {
    case 'added':
      return 'bg-green-100 dark:bg-green-900/30';
    case 'removed':
      return 'bg-red-100 dark:bg-red-900/30';
    case 'modified':
      return 'bg-yellow-100 dark:bg-yellow-900/30';
    default:
      return '';
  }
}

/**
 * Get text color class based on line status
 */
function getLineTextClass(status: DiffLineStatus): string {
  switch (status) {
    case 'added':
      return 'text-green-800 dark:text-green-300';
    case 'removed':
      return 'text-red-800 dark:text-red-300';
    case 'modified':
      return 'text-yellow-800 dark:text-yellow-300';
    default:
      return 'text-gray-800 dark:text-gray-200';
  }
}

/**
 * Get line number color class based on status
 */
function getLineNumberClass(status: DiffLineStatus): string {
  switch (status) {
    case 'added':
      return 'text-green-600 dark:text-green-400';
    case 'removed':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-gray-400 dark:text-gray-600';
  }
}

/**
 * DiffPanel - Renders one side of the diff
 */
interface DiffPanelProps {
  title: string;
  lines: DiffLine[];
  emptyMessage?: string;
}

const DiffPanel: React.FC<DiffPanelProps> = ({
  title,
  lines,
  emptyMessage = 'No content',
}) => {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Panel header */}
      <div
        className="
          flex-shrink-0
          px-4 py-2
          bg-gray-100 dark:bg-gray-800
          border-b border-gray-200 dark:border-gray-700
          text-sm font-medium text-gray-700 dark:text-gray-300
        "
      >
        {title}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-auto bg-white dark:bg-gray-900">
        {lines.length === 0 ||
        (lines.length === 1 && lines[0].content.trim() === '') ? (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-600 text-sm">
            {emptyMessage}
          </div>
        ) : (
          <div className="font-mono text-sm">
            {lines.map((line, index) => (
              <div
                key={index}
                className={`
                  flex
                  ${getLineBackgroundClass(line.status)}
                  hover:bg-gray-50 dark:hover:bg-gray-800/50
                `}
              >
                {/* Line number */}
                <div
                  className={`
                    flex-shrink-0
                    w-12
                    px-2 py-0.5
                    text-right
                    select-none
                    border-r border-gray-200 dark:border-gray-700
                    ${getLineNumberClass(line.status)}
                  `}
                >
                  {line.lineNumber}
                </div>

                {/* Line content */}
                <div
                  className={`
                    flex-1
                    px-3 py-0.5
                    whitespace-pre-wrap
                    break-all
                    ${getLineTextClass(line.status)}
                  `}
                >
                  {line.content || '\u00A0'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * DraftDiffViewer component - Side-by-side diff viewer
 */
export const DraftDiffViewer: React.FC<DraftDiffViewerProps> = ({
  current,
  draft,
  language,
  className = '',
}) => {
  // Compute diff
  const { currentLines, draftLines } = useMemo(
    () => computeDiff(current, draft),
    [current, draft]
  );

  // Calculate stats
  const stats = useMemo(() => {
    const additions = draftLines.filter((l) => l.status === 'added').length;
    const deletions = currentLines.filter((l) => l.status === 'removed').length;
    return { additions, deletions };
  }, [currentLines, draftLines]);

  return (
    <div
      className={`
        flex flex-col
        border border-gray-200 dark:border-gray-700
        rounded-lg
        overflow-hidden
        ${className}
      `}
    >
      {/* Stats bar */}
      <div
        className="
          flex items-center justify-between
          px-4 py-2
          bg-gray-50 dark:bg-gray-800
          border-b border-gray-200 dark:border-gray-700
          text-sm
        "
      >
        <div className="flex items-center gap-4">
          {language && (
            <span className="text-gray-500 dark:text-gray-400">
              {language}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-green-600 dark:text-green-400">
            +{stats.additions} additions
          </span>
          <span className="text-red-600 dark:text-red-400">
            -{stats.deletions} deletions
          </span>
        </div>
      </div>

      {/* Diff panels */}
      <div className="flex flex-1 min-h-[400px]">
        <DiffPanel
          title="Current"
          lines={currentLines}
          emptyMessage="No current content"
        />

        {/* Divider */}
        <div className="w-px bg-gray-200 dark:bg-gray-700" />

        <DiffPanel
          title="Draft"
          lines={draftLines}
          emptyMessage="No draft content"
        />
      </div>
    </div>
  );
};

export default DraftDiffViewer;
