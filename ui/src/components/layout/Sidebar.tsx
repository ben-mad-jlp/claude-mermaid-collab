/**
 * Sidebar Component
 *
 * Left sidebar with:
 * - Item cards for diagrams and documents
 * - Search input for filtering
 * - Collapsible functionality
 * - Selected state indication
 *
 * Integrates with useUIStore for sidebar visibility state
 * and useSessionStore for diagrams/documents data.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { ItemCard } from '@/components/layout/ItemCard';
import { Item } from '@/types';

export interface SidebarProps {
  /** Optional custom class name */
  className?: string;
}

/**
 * Collapsible sidebar component with item cards
 */
export const Sidebar: React.FC<SidebarProps> = ({
  className = '',
}) => {
  const { sidebarVisible, toggleSidebar } = useUIStore(
    useShallow((state) => ({
      sidebarVisible: state.sidebarVisible,
      toggleSidebar: state.toggleSidebar,
    }))
  );

  const {
    diagrams,
    documents,
    selectedDiagramId,
    selectedDocumentId,
    selectDiagram,
    selectDocument,
  } = useSessionStore(
    useShallow((state) => ({
      diagrams: state.diagrams,
      documents: state.documents,
      selectedDiagramId: state.selectedDiagramId,
      selectedDocumentId: state.selectedDocumentId,
      selectDiagram: state.selectDiagram,
      selectDocument: state.selectDocument,
    }))
  );

  const [searchQuery, setSearchQuery] = useState('');

  const handleToggle = useCallback(() => {
    toggleSidebar();
  }, [toggleSidebar]);

  const handleItemClick = useCallback(
    (item: Item) => {
      if (item.type === 'diagram') {
        selectDiagram(item.id);
      } else {
        selectDocument(item.id);
      }
    },
    [selectDiagram, selectDocument]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    []
  );

  // Combine diagrams and documents into Item[], sort by lastModified desc, filter by search
  const filteredItems = useMemo(() => {
    const items: Item[] = [
      ...diagrams.map((d) => ({ ...d, type: 'diagram' as const })),
      ...documents.map((d) => ({ ...d, type: 'document' as const })),
    ];

    // Sort by lastModified descending
    items.sort((a, b) => b.lastModified - a.lastModified);

    // Filter by search query (case-insensitive)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return items.filter((item) => item.name.toLowerCase().includes(query));
    }

    return items;
  }, [diagrams, documents, searchQuery]);

  // Determine if an item is selected
  const isItemSelected = useCallback(
    (item: Item) => {
      if (item.type === 'diagram') {
        return item.id === selectedDiagramId;
      }
      return item.id === selectedDocumentId;
    },
    [selectedDiagramId, selectedDocumentId]
  );

  return (
    <aside
      data-testid="sidebar"
      className={`
        flex flex-col
        bg-gray-50 dark:bg-gray-900
        border-r border-gray-200 dark:border-gray-700
        transition-all duration-200
        ${sidebarVisible ? 'w-56' : 'w-14'}
        ${className}
      `.trim()}
    >
      {/* Toggle Button */}
      <div className="flex items-center justify-end p-2 border-b border-gray-200 dark:border-gray-700">
        <button
          data-testid="sidebar-toggle"
          onClick={handleToggle}
          aria-label={sidebarVisible ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={sidebarVisible}
          className="
            p-1.5
            text-gray-500 dark:text-gray-400
            hover:text-gray-700 dark:hover:text-gray-200
            hover:bg-gray-200 dark:hover:bg-gray-700
            rounded
            transition-colors
          "
        >
          <svg
            className={`w-5 h-5 transition-transform ${sidebarVisible ? '' : 'rotate-180'}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Items List */}
      <div className="flex-1 py-2 overflow-y-auto" role="navigation" aria-label="Sidebar items">
        {filteredItems.length === 0 ? (
          <div
            data-testid="sidebar-empty"
            className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400"
          >
            {sidebarVisible && (searchQuery ? 'No matching items' : 'No items')}
          </div>
        ) : (
          <div className="space-y-2 px-2">
            {filteredItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                isSelected={isItemSelected(item)}
                onClick={() => handleItemClick(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Search Input */}
      {sidebarVisible && (
        <div className="p-2 border-t border-gray-200 dark:border-gray-700">
          <input
            data-testid="sidebar-search"
            type="text"
            placeholder="Search items..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="
              w-full
              px-3 py-2
              text-sm
              bg-white dark:bg-gray-800
              border border-gray-300 dark:border-gray-600
              rounded-lg
              placeholder-gray-400 dark:placeholder-gray-500
              text-gray-900 dark:text-white
              focus:outline-none
              focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400
              focus:border-transparent
              transition-colors
            "
          />
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
