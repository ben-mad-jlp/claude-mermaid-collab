/**
 * ItemGrid Component
 *
 * Grid layout for displaying multiple items (diagrams and documents) with:
 * - Responsive grid layout
 * - Item filtering and searching
 * - Empty state handling
 * - Selection support
 * - Loading state
 *
 * Integrates with useSession hook for item management.
 */

import React, { useMemo, useCallback, useState } from 'react';
import { Diagram, Document } from '@/types';
import { Wireframe } from '@/stores/sessionStore';
import ItemCard from './ItemCard';

export type GridItem = (Diagram | Document | Wireframe) & {
  type: 'diagram' | 'document' | 'wireframe';
};

export interface ItemGridProps {
  /** Items to display */
  items?: GridItem[];
  /** Currently selected item ID */
  selectedItemId?: string | null;
  /** Callback when an item card is clicked */
  onItemClick?: (item: GridItem) => void;
  /** Whether to show a search filter */
  showSearch?: boolean;
  /** Columns in responsive grid */
  columns?: {
    mobile?: number;
    tablet?: number;
    desktop?: number;
  };
  /** Optional custom class name */
  className?: string;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Error message if any */
  error?: string | null;
}

/**
 * ItemGrid component for displaying items in a responsive grid
 */
export const ItemGrid: React.FC<ItemGridProps> = ({
  items = [],
  selectedItemId,
  onItemClick,
  showSearch = true,
  columns = { mobile: 1, tablet: 2, desktop: 3 },
  className = '',
  isLoading = false,
  error = null,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;

    const query = searchQuery.toLowerCase();
    return items.filter((item) =>
      item.name.toLowerCase().includes(query) ||
      item.type.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  const handleItemClick = useCallback(
    (item: GridItem) => {
      onItemClick?.(item);
    },
    [onItemClick]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    []
  );

  // Loading state
  if (isLoading) {
    return (
      <div
        data-testid="item-grid-loading"
        className={`
          flex items-center justify-center
          h-full
          ${className}
        `}
      >
        <div className="text-center">
          <div className="inline-block">
            <div
              className="
                w-8 h-8
                border-3 border-gray-300 dark:border-gray-600
                border-t-accent-500 dark:border-t-accent-400
                rounded-full
                animate-spin
              "
            />
          </div>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            Loading items...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        data-testid="item-grid-error"
        className={`
          flex items-center justify-center
          h-full
          ${className}
        `}
      >
        <div className="text-center p-6">
          <svg
            className="w-12 h-12 mx-auto text-red-500 mb-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            Error loading items
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div
        data-testid="item-grid-empty"
        className={`
          flex items-center justify-center
          h-full
          ${className}
        `}
      >
        <div className="text-center">
          <svg
            className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-600 mb-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M9 12h6m-6 4h6M9 8h6" />
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            No items
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No diagrams or documents in this session yet
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="item-grid"
      className={`
        flex flex-col
        h-full
        ${className}
      `}
    >
      {/* Search Bar */}
      {showSearch && (
        <div
          data-testid="item-grid-search"
          className="
            px-4 py-3
            border-b border-gray-200 dark:border-gray-700
            bg-white dark:bg-gray-800
          "
        >
          <div className="relative">
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="
                w-full
                px-3 py-2
                text-sm
                border border-gray-300 dark:border-gray-600
                rounded-lg
                bg-white dark:bg-gray-700
                text-gray-900 dark:text-white
                placeholder-gray-500 dark:placeholder-gray-400
                focus:outline-none
                focus:ring-2 focus:ring-accent-500
                focus:border-transparent
                transition-all
              "
            />
            {/* Search Icon */}
            <svg
              className="
                absolute right-3 top-1/2 -translate-y-1/2
                w-4 h-4
                text-gray-400 dark:text-gray-500
                pointer-events-none
              "
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      )}

      {/* Items Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredItems.length === 0 && searchQuery ? (
          <div
            data-testid="item-grid-no-results"
            className="flex items-center justify-center h-full"
          >
            <div className="text-center">
              <svg
                className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-600 mb-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                No results found
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Try searching with different keywords
              </p>
            </div>
          </div>
        ) : (
          <div
            className={`
              grid
              gap-4
              grid-cols-1
              sm:grid-cols-${columns.tablet || 2}
              lg:grid-cols-${columns.desktop || 3}
            `}
          >
            {filteredItems.map((item) => (
              <ItemCard
                key={`${item.type}-${item.id}`}
                id={item.id}
                name={item.name}
                type={item.type}
                lastModified={item.lastModified}
                isSelected={item.id === selectedItemId}
                onClick={() => handleItemClick(item)}
                data-testid={`item-grid-card-${item.id}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer with item count */}
      {showSearch && (
        <div
          data-testid="item-grid-footer"
          className="
            px-4 py-2
            border-t border-gray-200 dark:border-gray-700
            bg-white dark:bg-gray-800
          "
        >
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {filteredItems.length} of {items.length}{' '}
            {items.length === 1 ? 'item' : 'items'}
          </p>
        </div>
      )}
    </div>
  );
};

export default ItemGrid;
