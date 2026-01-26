/**
 * Sidebar Component
 *
 * Fixed-width left sidebar with:
 * - Item cards for diagrams and documents
 * - Search input for filtering
 * - Selected state indication
 *
 * Integrates with useSessionStore for diagrams/documents data.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { useDataLoader } from '@/hooks/useDataLoader';
import { ItemCard } from '@/components/layout/ItemCard';
import { Item } from '@/types';

export interface SidebarProps {
  /** Optional custom class name */
  className?: string;
}

/**
 * Fixed-width sidebar component with item cards
 */
export const Sidebar: React.FC<SidebarProps> = ({
  className = '',
}) => {
  const {
    diagrams,
    documents,
    selectedDiagramId,
    selectedDocumentId,
    currentSession,
  } = useSessionStore(
    useShallow((state) => ({
      diagrams: state.diagrams,
      documents: state.documents,
      selectedDiagramId: state.selectedDiagramId,
      selectedDocumentId: state.selectedDocumentId,
      currentSession: state.currentSession,
    }))
  );

  const { selectDiagramWithContent, selectDocumentWithContent } = useDataLoader();

  const [searchQuery, setSearchQuery] = useState('');

  const handleItemClick = useCallback(
    (item: Item) => {
      if (!currentSession) return;

      if (item.type === 'diagram') {
        selectDiagramWithContent(currentSession.project, currentSession.name, item.id);
      } else {
        selectDocumentWithContent(currentSession.project, currentSession.name, item.id);
      }
    },
    [currentSession, selectDiagramWithContent, selectDocumentWithContent]
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
        w-56
        bg-gray-50 dark:bg-gray-900
        border-r border-gray-200 dark:border-gray-700
        ${className}
      `.trim()}
    >
      {/* Search Input */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
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

      {/* Items List */}
      <div className="flex-1 py-2 overflow-y-auto" role="navigation" aria-label="Sidebar items">
        {filteredItems.length === 0 ? (
          <div
            data-testid="sidebar-empty"
            className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400"
          >
            {searchQuery ? 'No matching items' : 'No items'}
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

      {/* Cross-link to Kodex */}
      <div className="p-2 border-t border-gray-200 dark:border-gray-700">
        <Link
          to="/kodex"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span className="text-sm">Kodex</span>
        </Link>
      </div>
    </aside>
  );
};

export default Sidebar;
