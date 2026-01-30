/**
 * ItemCard Component
 *
 * Card displaying item information with:
 * - Item name as title
 * - Item type and relative time as subtitle
 * - Selected state styling
 * - Click handler for selection
 *
 * Used in the sidebar to display diagrams and documents.
 */

import React from 'react';
import { Item } from '@/types';

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
 * Get icon for item type
 */
function getItemIcon(type: 'diagram' | 'document' | 'wireframe'): React.ReactNode {
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
  if (type === 'wireframe') {
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
}) => {
  const relativeTime = formatRelativeTime(item.lastModified);
  const typeLabel = item.type === 'diagram' ? 'Diagram' : item.type === 'wireframe' ? 'Wireframe' : 'Document';

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

          {/* Type and Relative Time */}
          <p
            className="
              text-xs text-gray-500 dark:text-gray-400
              truncate
              mt-1
            "
          >
            {typeLabel} &bull; {relativeTime}
          </p>
        </div>

        {/* Delete Button */}
        {showDelete && onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="
              flex-shrink-0
              p-1.5
              text-gray-400 hover:text-red-500
              dark:text-gray-500 dark:hover:text-red-400
              opacity-0 group-hover:opacity-100
              transition-all
              rounded
              hover:bg-red-50 dark:hover:bg-red-900/20
            "
            aria-label={`Delete ${item.name}`}
            title="Delete item"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default ItemCard;
