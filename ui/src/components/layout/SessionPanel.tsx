/**
 * SessionPanel Component
 *
 * Panel displaying session information and item list with:
 * - Session details (name, phase, activity)
 * - List of diagrams and documents
 * - Update indicators for items with changes
 * - Click navigation to items
 * - Real-time updates via WebSocket
 *
 * Integrates with useSession hook for state management.
 */

import React, { useCallback, useMemo } from 'react';
import { useSession } from '@/hooks/useSession';
import { Diagram, Document, Session } from '@/types';

export interface Wireframe {
  id: string;
  name: string;
  lastModified?: number;
}

export type SessionItem = (Diagram | Document | Wireframe) & {
  type: 'diagram' | 'document' | 'wireframe';
  hasUpdate?: boolean;
};

export interface SessionPanelProps {
  /** Current session to display */
  session?: Session | null;
  /** Diagrams in the session */
  diagrams?: Diagram[];
  /** Documents in the session */
  documents?: Document[];
  /** Wireframes in the session */
  wireframes?: Wireframe[];
  /** Currently selected item ID */
  selectedItemId?: string | null;
  /** Callback when an item is clicked */
  onItemClick?: (item: SessionItem) => void;
  /** Callback when opening in new tab */
  onItemOpenNewTab?: (item: SessionItem) => void;
  /** Optional custom class name */
  className?: string;
  /** Whether the panel is in compact mode */
  compact?: boolean;
}

/**
 * Format relative time from timestamp
 */
function formatRelativeTime(timestamp: number | string | undefined): string {
  if (!timestamp) return '';

  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Get icon for item type
 */
function getItemIcon(type: 'diagram' | 'document' | 'wireframe'): React.ReactNode {
  if (type === 'diagram') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
        <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
      </svg>
    );
  }

  if (type === 'wireframe') {
    // Wireframe icon - phone/screen outline
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M5 2a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2H5zm0 2h10v10H5V4zm3 11a1 1 0 112 0 1 1 0 01-2 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * SessionPanel component displaying session info and items
 */
export const SessionPanel: React.FC<SessionPanelProps> = ({
  session,
  diagrams = [],
  documents = [],
  wireframes = [],
  selectedItemId,
  onItemClick,
  onItemOpenNewTab,
  className = '',
  compact = false,
}) => {
  // Combine diagrams, documents, and wireframes into a unified list
  const items: SessionItem[] = useMemo(() => {
    const diagramItems: SessionItem[] = diagrams.map((d) => ({
      ...d,
      type: 'diagram' as const,
    }));

    const documentItems: SessionItem[] = documents.map((d) => ({
      ...d,
      type: 'document' as const,
    }));

    const wireframeItems: SessionItem[] = wireframes.map((w) => ({
      ...w,
      type: 'wireframe' as const,
    }));

    // Sort by lastModified (most recent first)
    return [...diagramItems, ...documentItems, ...wireframeItems].sort((a, b) => {
      const aTime = a.lastModified || 0;
      const bTime = b.lastModified || 0;
      return bTime - aTime;
    });
  }, [diagrams, documents, wireframes]);

  const handleItemClick = useCallback(
    (item: SessionItem) => {
      onItemClick?.(item);
    },
    [onItemClick]
  );

  const handleOpenNewTab = useCallback(
    (e: React.MouseEvent, item: SessionItem) => {
      e.stopPropagation();
      onItemOpenNewTab?.(item);
    },
    [onItemOpenNewTab]
  );

  // Empty state
  if (!session) {
    return (
      <div
        data-testid="session-panel"
        className={`
          flex flex-col
          bg-gray-50 dark:bg-gray-900
          h-full
          ${className}
        `}
      >
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <svg
              className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-600 mb-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M20 7L12 3L4 7M20 7L12 11M20 7V17L12 21M12 11L4 7M12 11V21M4 7V17L12 21" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No session selected
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="session-panel"
      className={`
        flex flex-col
        bg-gray-50 dark:bg-gray-900
        h-full
        ${className}
      `}
    >
      {/* Session Header */}
      {!compact && (
        <div
          data-testid="session-panel-header"
          className="
            px-4 py-3
            border-b border-gray-200 dark:border-gray-700
            bg-white dark:bg-gray-800
          "
        >
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {session.name}
          </h2>
          {session.displayName && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Status:
              </span>
              <span
                className="
                  px-1.5 py-0.5
                  text-xs font-medium
                  bg-accent-100 dark:bg-accent-900/40
                  text-accent-700 dark:text-accent-300
                  rounded
                "
              >
                {session.displayName}
              </span>
            </div>
          )}
          {session.lastActivity && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Active {formatRelativeTime(session.lastActivity)}
            </p>
          )}
        </div>
      )}

      {/* Items List */}
      <div
        data-testid="session-panel-items"
        className="flex-1 overflow-y-auto"
      >
        {items.length === 0 ? (
          <div
            data-testid="session-panel-empty"
            className="p-4 text-center"
          >
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No items in session
            </p>
          </div>
        ) : (
          <ul className="py-2">
            {items.map((item) => {
              const isSelected = item.id === selectedItemId;
              return (
                <li key={`${item.type}-${item.id}`}>
                  <button
                    data-testid={`session-item-${item.id}`}
                    onClick={() => handleItemClick(item)}
                    className={`
                      w-full
                      flex items-center gap-3
                      px-4 py-2.5
                      text-left
                      transition-colors
                      ${
                        isSelected
                          ? 'bg-accent-100 dark:bg-accent-900/40'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                      }
                    `}
                  >
                    {/* Icon */}
                    <span
                      className={`
                        flex-shrink-0
                        ${
                          isSelected
                            ? 'text-accent-600 dark:text-accent-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }
                      `}
                    >
                      {getItemIcon(item.type)}
                    </span>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`
                            text-sm font-medium truncate
                            ${
                              isSelected
                                ? 'text-accent-700 dark:text-accent-300'
                                : 'text-gray-900 dark:text-white'
                            }
                          `}
                        >
                          {item.name}
                        </span>

                        {/* Update indicator */}
                        {item.hasUpdate && !isSelected && (
                          <span
                            data-testid={`item-badge-${item.id}`}
                            className="
                              flex-shrink-0
                              w-2 h-2
                              bg-accent-500
                              rounded-full
                            "
                            aria-label="Has updates"
                          />
                        )}
                      </div>

                      {/* Type and time */}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                          {item.type}
                        </span>
                        {item.lastModified && (
                          <>
                            <span className="text-gray-300 dark:text-gray-600">
                              {'\u00B7'}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {formatRelativeTime(item.lastModified)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Open in new tab button */}
                    {onItemOpenNewTab && (
                      <button
                        data-testid={`item-newtab-${item.id}`}
                        onClick={(e) => handleOpenNewTab(e, item)}
                        className="
                          flex-shrink-0
                          p-1
                          text-gray-400 dark:text-gray-500
                          hover:text-gray-600 dark:hover:text-gray-300
                          hover:bg-gray-200 dark:hover:bg-gray-700
                          rounded
                          opacity-0 group-hover:opacity-100
                          transition-all
                        "
                        aria-label={`Open ${item.name} in new tab`}
                      >
                        <svg
                          className="w-4 h-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                          <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                        </svg>
                      </button>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer with item count */}
      <div
        data-testid="session-panel-footer"
        className="
          px-4 py-2
          border-t border-gray-200 dark:border-gray-700
          bg-white dark:bg-gray-800
        "
      >
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </p>
      </div>
    </div>
  );
};

export default SessionPanel;
