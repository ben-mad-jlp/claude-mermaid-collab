/**
 * PreviewTab Component
 *
 * Full-screen preview tab for mobile with item drawer integration.
 * Renders MermaidPreview or MarkdownPreview based on selected item type.
 * Features:
 * - Compact top bar with item name, type icon, and browse button
 * - Full-screen diagram or document preview with zoom/pan support
 * - Slide-up drawer for browsing and selecting items
 * - Auto-opens drawer when no item is selected
 */

import React, { useState, useEffect } from 'react';
import { MermaidPreview } from '@/components/editors/MermaidPreview';
import { MarkdownPreview } from '@/components/editors/MarkdownPreview';
import { ItemDrawer } from './ItemDrawer';
import type { Item } from '@/types';

export interface PreviewTabProps {
  /** Currently selected item (diagram or document) */
  selectedItem: Item | null;
  /** All available items for the drawer */
  items: Item[];
  /** Callback when an item is selected */
  onItemSelect: (item: Item) => void;
  /** Optional custom class name */
  className?: string;
}

/**
 * PreviewTab component - full-screen preview with item drawer
 */
export const PreviewTab: React.FC<PreviewTabProps> = ({
  selectedItem,
  items,
  onItemSelect,
  className = '',
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Auto-open drawer if no item selected
  useEffect(() => {
    if (!selectedItem && items.length > 0) {
      setIsDrawerOpen(true);
    }
  }, [selectedItem, items]);

  // Handle item selection: call callback and close drawer
  const handleItemSelect = (item: Item) => {
    onItemSelect(item);
    setIsDrawerOpen(false);
  };

  // Get the appropriate icon for the item type
  const getItemTypeIcon = () => {
    if (selectedItem?.type === 'diagram') {
      return (
        <svg
          className="w-5 h-5"
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

    // Document icon
    return (
      <svg
        className="w-5 h-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M9 12h6M9 16h6M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  };

  return (
    <div
      data-testid="preview-tab"
      className={`flex flex-col h-full ${className}`}
    >
      {/* Top Bar - only show if item is selected */}
      {selectedItem && (
        <div
          data-testid="preview-top-bar"
          className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0"
        >
          {/* Item type icon */}
          <div
            data-testid="item-type-icon"
            className="text-gray-600 dark:text-gray-400 flex-shrink-0"
          >
            {getItemTypeIcon()}
          </div>

          {/* Item name (truncated) */}
          <div className="flex-1 min-w-0">
            <p
              data-testid="preview-item-name"
              className="text-sm font-semibold text-gray-900 dark:text-white truncate"
              title={selectedItem.name}
            >
              {selectedItem.name}
            </p>
          </div>

          {/* Browse button */}
          <button
            data-testid="preview-browse-button"
            onClick={() => setIsDrawerOpen(true)}
            className="flex-shrink-0 px-3 py-1 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 dark:bg-accent-600 dark:hover:bg-accent-700 rounded-lg transition-colors"
          >
            Browse
          </button>
        </div>
      )}

      {/* Preview Content Area */}
      <div
        data-testid="preview-content"
        className="flex-1 min-h-0 overflow-hidden bg-white dark:bg-gray-900"
      >
        {selectedItem ? (
          selectedItem.type === 'diagram' ? (
            // Render MermaidPreview for diagrams
            <MermaidPreview content={selectedItem.content} />
          ) : (
            // Render MarkdownPreview for documents
            <MarkdownPreview content={selectedItem.content} />
          )
        ) : (
          // Empty state - show prompt to select an item
          <div
            data-testid="preview-empty-state"
            className="flex items-center justify-center h-full"
          >
            <div className="text-center">
              <svg
                className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-600 mb-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">
                Select an item to preview
              </p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                Browse items from the drawer below
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Item Drawer */}
      <ItemDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        items={items}
        selectedItemId={selectedItem?.id ?? null}
        onItemSelect={handleItemSelect}
      />
    </div>
  );
};

export default PreviewTab;
