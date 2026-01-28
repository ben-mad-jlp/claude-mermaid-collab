/**
 * ItemDrawer Component
 *
 * Slide-up bottom sheet for item selection on mobile devices.
 * Features:
 * - Backdrop overlay that dismisses on tap
 * - Search input to filter items
 * - Scrollable list of items sorted by last modified
 * - Drag handle for gesture dismissal
 * - Item selection with callback
 */

import React, { useState, useRef, useEffect } from 'react';
import { Item } from '@/types';
import { ItemCard } from '@/components/layout/ItemCard';

export interface ItemDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Callback to close the drawer */
  onClose: () => void;
  /** All available items to display */
  items: Item[];
  /** Currently selected item ID (for highlighting) */
  selectedItemId: string | null;
  /** Callback when an item is selected */
  onItemSelect: (item: Item) => void;
  /** Optional custom class name */
  className?: string;
}

/**
 * Sort items by lastModified in descending order (newest first)
 */
function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * Filter items by search query (case-insensitive)
 */
function filterItems(items: Item[], query: string): Item[] {
  if (!query.trim()) {
    return items;
  }

  const lowerQuery = query.toLowerCase();
  return items.filter((item) =>
    item.name.toLowerCase().includes(lowerQuery)
  );
}

/**
 * ItemDrawer component - slide-up bottom sheet for item selection
 */
export const ItemDrawer: React.FC<ItemDrawerProps> = ({
  isOpen,
  onClose,
  items,
  selectedItemId,
  onItemSelect,
  className,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sort items by lastModified
  const sortedItems = sortItems(items);

  // Filter items based on search query
  const filteredItems = filterItems(sortedItems, searchQuery);

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    // Reset scroll position when search changes
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  };

  // Handle item selection
  const handleItemSelect = (item: Item) => {
    onItemSelect(item);
    onClose();
  };

  // Handle backdrop click
  const handleBackdropClick = () => {
    onClose();
  };

  // Handle sheet click to prevent backdrop propagation
  const handleSheetClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  // Handle drag gesture on handle
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      setTouchStart(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    // Touch move tracking happens in handleTouchEnd
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStart !== null && e.changedTouches.length > 0) {
      const touchEnd = e.changedTouches[0].clientY;
      const deltaY = touchEnd - touchStart;

      // If dragged down more than 100px, close the drawer
      if (deltaY > 100) {
        onClose();
      }

      setTouchStart(null);
    }
  };

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div
      data-testid="item-drawer"
      className={className}
    >
      {/* Backdrop Overlay */}
      <div
        data-testid="item-drawer-backdrop"
        onClick={handleBackdropClick}
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        aria-hidden="true"
      />

      {/* Bottom Sheet */}
      <div
        data-testid="item-drawer-sheet"
        onClick={handleSheetClick}
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-3xl z-50 max-h-[60vh] flex flex-col shadow-2xl dark:shadow-gray-950/50"
      >
        {/* Drag Handle */}
        <div
          data-testid="item-drawer-handle"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          className="pt-3 pb-2 px-4 cursor-grab active:cursor-grabbing flex justify-center"
        >
          <div className="w-12 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        {/* Search Input */}
        <div className="px-4 pb-3 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            placeholder="Search items..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400"
          />
        </div>

        {/* Scrollable Item List */}
        <div
          data-testid="item-drawer-list"
          ref={listRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
        >
          {filteredItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
              {items.length === 0 ? 'No items in session' : 'No items found'}
            </div>
          ) : (
            filteredItems.map((item) => (
              <button
                key={item.id}
                data-testid={`item-drawer-item-${item.id}`}
                onClick={() => handleItemSelect(item)}
                className={`
                  w-full
                  bg-white dark:bg-gray-800
                  border
                  rounded-lg
                  p-3
                  text-left
                  transition-all
                  hover:shadow-md dark:hover:shadow-gray-900/50
                  ${
                    selectedItemId === item.id
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
                        selectedItemId === item.id
                          ? 'bg-accent-100 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-accent-50 dark:hover:bg-accent-900/20 hover:text-accent-600 dark:hover:text-accent-400'
                      }
                    `}
                  >
                    {item.type === 'diagram' ? (
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
                    ) : (
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
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Item Name */}
                    <h3
                      className={`
                        text-sm font-semibold truncate
                        transition-colors
                        ${
                          selectedItemId === item.id
                            ? 'text-accent-700 dark:text-accent-300'
                            : 'text-gray-900 dark:text-white'
                        }
                      `}
                      title={item.name}
                    >
                      {item.name}
                    </h3>

                    {/* Type Label */}
                    <p
                      className="
                        text-xs text-gray-500 dark:text-gray-400
                        truncate
                        mt-1
                      "
                    >
                      {item.type === 'diagram' ? 'Diagram' : 'Document'}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ItemDrawer;
