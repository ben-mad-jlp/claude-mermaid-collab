/**
 * ItemCard Component
 *
 * Card displaying diagram or document information with:
 * - Item name and type badge
 * - Last modified timestamp
 * - Click to open functionality
 * - Hover states and styling
 * - Support for both diagrams and documents
 *
 * Integrates with useSession hook for item management.
 */

import React from 'react';
import { Diagram, Document } from '@/types';

export type ItemType = 'diagram' | 'document' | 'wireframe';

export interface ItemCardProps {
  /** Item ID (diagram or document) */
  id: string;
  /** Item name */
  name: string;
  /** Item type (diagram or document) */
  type: ItemType;
  /** Last modified timestamp (milliseconds) */
  lastModified?: number;
  /** Whether this item is currently selected */
  isSelected?: boolean;
  /** Callback when card is clicked */
  onClick?: () => void;
  /** Optional custom class name */
  className?: string;
}

/**
 * Format relative time from timestamp
 */
function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return '';

  const date = new Date(timestamp);
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
function getItemIcon(type: ItemType): React.ReactNode {
  if (type === 'diagram') {
    return (
      <svg
        className="w-5 h-5"
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
        className="w-5 h-5"
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

  // Document icon
  return (
    <svg
      className="w-5 h-5"
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
 * ItemCard component for displaying diagram or document info
 */
export const ItemCard: React.FC<ItemCardProps> = ({
  id,
  name,
  type,
  lastModified,
  isSelected = false,
  onClick,
  className = '',
}) => {
  return (
    <button
      data-testid={`item-card-${id}`}
      onClick={onClick}
      className={`
        group
        w-full
        bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700
        rounded-lg
        p-4
        text-left
        transition-all
        hover:shadow-md dark:hover:shadow-gray-900/50
        hover:border-accent-300 dark:hover:border-accent-600
        ${
          isSelected
            ? 'ring-2 ring-accent-500 dark:ring-accent-400 border-accent-400 dark:border-accent-500'
            : 'hover:border-accent-300 dark:hover:border-accent-600'
        }
        ${className}
      `}
    >
      {/* Card Header */}
      <div className="flex items-start justify-between mb-3">
        {/* Icon and Name */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
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
            {getItemIcon(type)}
          </div>

          <div className="flex-1 min-w-0">
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
              title={name}
            >
              {name}
            </h3>

            {/* Type Badge */}
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`
                  inline-block
                  px-2 py-1
                  text-xs font-medium
                  rounded
                  capitalize
                  transition-colors
                  ${
                    isSelected
                      ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  }
                `}
              >
                {type}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Card Footer - Last Modified */}
      {lastModified && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Last modified
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">
            {formatRelativeTime(lastModified)}
          </span>
        </div>
      )}
    </button>
  );
};

export default ItemCard;
