/**
 * ItemCard Component
 *
 * Card displaying item information with:
 * - Item name as title
 * - Item type and relative time as subtitle
 * - Selected state styling
 * - Click handler for selection
 * - Snippet-specific metadata (language, line count, size)
 *
 * Used in the sidebar to display diagrams, documents, designs, spreadsheets, and snippets.
 */

import React, { useMemo } from 'react';
import { Item, isSnippet } from '@/types';

export interface ItemCardProps {
  /** Item to display */
  item: Item;
  /** Whether this item is currently selected */
  isSelected: boolean;
  /** Callback when card is clicked */
  onClick: () => void;
  /** Callback when delete button is clicked */
  onDelete?: () => void;
  /** Whether to show the delete button */
  showDelete?: boolean;
  /** Callback when deprecate/restore button is clicked */
  onDeprecate?: () => void;
}

/**
 * Format relative time from timestamp
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

/**
 * Detect language from snippet name/filename
 */
function detectLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || 'text';
  const langMap: Record<string, string> = {
    'js': 'JavaScript',
    'ts': 'TypeScript',
    'jsx': 'JSX',
    'tsx': 'TSX',
    'py': 'Python',
    'java': 'Java',
    'cpp': 'C++',
    'c': 'C',
    'rs': 'Rust',
    'go': 'Go',
    'rb': 'Ruby',
    'php': 'PHP',
    'sql': 'SQL',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'json': 'JSON',
    'yaml': 'YAML',
    'yml': 'YAML',
    'md': 'Markdown',
    'sh': 'Shell',
    'bash': 'Bash',
    'xml': 'XML',
  };
  return langMap[ext] || 'Text';
}

/**
 * Get snippet-specific metadata
 */
interface SnippetMetadata {
  language: string;
  lines: number;
  size: string;
}

function getSnippetMetadata(item: Item): SnippetMetadata {
  // Parse JSON content envelope to extract code and language
  let code = item.content ?? '';
  let language = detectLanguage(item.name);
  try {
    const parsed = JSON.parse(code);
    if (typeof parsed.code === 'string') code = parsed.code;
    if (typeof parsed.filePath === 'string') language = detectLanguage(parsed.filePath) || language;
    // Map language identifiers to display names
    if (typeof parsed.language === 'string') {
      const displayNames: Record<string, string> = {
        javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
        csharp: 'C#', cpp: 'C++', css: 'CSS', html: 'HTML', json: 'JSON',
        markdown: 'Markdown', yaml: 'YAML', text: 'Text',
      };
      language = displayNames[parsed.language] || parsed.language;
    }
  } catch { /* use raw content as fallback */ }
  const lines = code.split('\n').length;
  const bytes = new Blob([code]).size;

  let size: string;
  if (bytes < 1024) {
    size = `${bytes}B`;
  } else if (bytes < 1024 * 1024) {
    size = `${(bytes / 1024).toFixed(1)}KB`;
  } else {
    size = `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  return { language, lines, size };
}

/**
 * Get icon for item type
 */
function getItemIcon(type: 'diagram' | 'document' | 'design' | 'spreadsheet' | 'snippet'): React.ReactNode {
  if (type === 'diagram') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M20 7L12 3L4 7M20 7L12 11M20 7V17L12 21M12 11L4 7M12 11V21M4 7V17L12 21" />
      </svg>
    );
  }
  if (type === 'design') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    );
  }
  if (type === 'spreadsheet') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      </svg>
    );
  }
  if (type === 'snippet') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  // Default document icon
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M9 12h6M9 16h6M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

/**
 * ItemCard component for displaying item information in sidebar
 */
export const ItemCard: React.FC<ItemCardProps> = ({
  item,
  isSelected,
  onClick,
  onDelete,
  showDelete,
  onDeprecate,
}) => {
  const relativeTime = formatRelativeTime(item.lastModified);
  const typeLabel = item.type === 'diagram' ? 'Diagram' : item.type === 'design' ? 'Design' : item.type === 'spreadsheet' ? 'Spreadsheet' : item.type === 'snippet' ? 'Snippet' : 'Document';

  // Get snippet-specific metadata if this is a snippet
  const snippetMetadata = useMemo(() => {
    return isSnippet(item) ? getSnippetMetadata(item) : null;
  }, [item]);

  return (
    <div
      data-testid={`item-card-${item.id}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`
        group
        w-full
        bg-white dark:bg-gray-800
        border
        rounded-lg
        p-3
        text-left
        transition-all
        cursor-pointer
        hover:shadow-md dark:hover:shadow-gray-900/50
        ${item.deprecated ? 'opacity-50' : ''}
        ${
          isSelected
            ? 'ring-2 ring-accent-500 dark:ring-accent-400 border-accent-400 dark:border-accent-500 bg-accent-50 dark:bg-accent-900/20'
            : 'border-gray-200 dark:border-gray-700 hover:border-accent-300 dark:hover:border-accent-600'
        }
      `}
    >
      <div className="flex items-start gap-3">
        {/* Item Icon */}
        <div
          className={`
            flex-shrink-0
            p-2
            rounded-lg
            transition-colors
            ${
              isSelected
                ? 'bg-accent-100 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 group-hover:bg-accent-50 dark:group-hover:bg-accent-900/20 group-hover:text-accent-600 dark:group-hover:text-accent-400'
            }
          `}
        >
          {getItemIcon(item.type)}
        </div>

        <div className="flex-1 min-w-0">
          {/* Item Name */}
          <h3
            className={`
              text-sm font-semibold truncate
              transition-colors
              ${
                isSelected
                  ? 'text-accent-700 dark:text-accent-300'
                  : 'text-gray-900 dark:text-white group-hover:text-accent-700 dark:group-hover:text-accent-300'
              }
            `}
            title={item.name}
          >
            {item.name}
          </h3>

          {/* Snippet Metadata (language, lines, size) */}
          {snippetMetadata && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">
              {snippetMetadata.language} &bull; {snippetMetadata.lines} lines &bull; {snippetMetadata.size}
            </p>
          )}

          {/* Type, Relative Time, and Action Buttons row */}
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {item.deprecated
                ? <span className="text-amber-600 dark:text-amber-400">deprecated</span>
                : <>{typeLabel} &bull; {relativeTime}</>
              }
            </p>

            {/* Action buttons — shown on hover */}
            {showDelete && (onDeprecate || onDelete) && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-1">
                {onDeprecate && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeprecate(); }}
                    className="p-1 text-gray-400 hover:text-amber-500 dark:text-gray-500 dark:hover:text-amber-400 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                    aria-label={item.deprecated ? `Restore ${item.name}` : `Deprecate ${item.name}`}
                    title={item.deprecated ? 'Restore' : 'Deprecate'}
                  >
                    {item.deprecated ? (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" />
                        <path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    aria-label={`Delete ${item.name}`}
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ItemCard;
