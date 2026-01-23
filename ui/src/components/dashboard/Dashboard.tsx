/**
 * Dashboard Component
 *
 * Main dashboard page showing sessions and items with:
 * - Session list in sidebar
 * - Item grid for selected session
 * - Split pane layout
 * - Session selection and navigation
 * - Real-time updates via WebSocket
 *
 * Integrates with:
 * - useSession hook for session state
 * - SplitPane for resizable layout
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { useDataLoader } from '@/hooks/useDataLoader';
import { useUIStore } from '@/stores/uiStore';
import SplitPane from '@/components/layout/SplitPane';
import SessionCard from './SessionCard';
import ItemGrid, { GridItem } from './ItemGrid';

/**
 * RefreshIcon component - SVG icon for the refresh button
 */
const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

export interface DashboardProps {
  /** List of available sessions */
  sessions?: any[];
  /** Callback when a session is selected */
  onSessionSelect?: (session: any) => void;
  /** Callback when an item is clicked */
  onItemClick?: (item: GridItem) => void;
  /** Optional custom class name */
  className?: string;
}

/**
 * Dashboard component for browsing sessions and items
 */
export const Dashboard: React.FC<DashboardProps> = ({
  sessions,
  onSessionSelect,
  onItemClick,
  className = '',
}) => {
  const {
    currentSession,
    diagrams,
    documents,
    selectedDiagramId,
    selectedDocumentId,
    setCurrentSession,
    selectDiagram,
    selectDocument,
  } = useSession();

  const sessionPanelSplitPosition = useUIStore(
    (state) => state.sessionPanelSplitPosition
  );
  const setSessionPanelSplitPosition = useUIStore(
    (state) => state.setSessionPanelSplitPosition
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { loadSessionItems } = useDataLoader();

  // Combine diagrams and documents into items
  const items: GridItem[] = useMemo(() => {
    const diagramItems: GridItem[] = diagrams.map((d) => ({
      ...d,
      type: 'diagram' as const,
    }));

    const documentItems: GridItem[] = documents.map((d) => ({
      ...d,
      type: 'document' as const,
    }));

    // Sort by lastModified (most recent first)
    let result = [...diagramItems, ...documentItems].sort((a, b) => {
      const aTime = a.lastModified || 0;
      const bTime = b.lastModified || 0;
      return bTime - aTime;
    });

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) =>
        item.name.toLowerCase().includes(query) ||
        item.type.toLowerCase().includes(query)
      );
    }

    return result;
  }, [diagrams, documents, searchQuery]);

  const selectedItemId = selectedDiagramId || selectedDocumentId;

  const handleSessionClick = useCallback(
    (session: any) => {
      setCurrentSession(session);
      onSessionSelect?.(session);
    },
    [setCurrentSession, onSessionSelect]
  );

  const handleItemClick = useCallback(
    (item: GridItem) => {
      if (item.type === 'diagram') {
        selectDiagram(item.id);
      } else {
        selectDocument(item.id);
      }
      onItemClick?.(item);
    },
    [selectDiagram, selectDocument, onItemClick]
  );

  const handlePanelResize = useCallback(
    (newSize: number) => {
      setSessionPanelSplitPosition(newSize);
    },
    [setSessionPanelSplitPosition]
  );

  const handleRefresh = useCallback(async () => {
    if (!currentSession) return;

    setIsRefreshing(true);

    try {
      // Fetch both in parallel
      await loadSessionItems(currentSession.project, currentSession.name);
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [currentSession, loadSessionItems]);

  return (
    <div
      data-testid="dashboard"
      className={`
        flex flex-col
        h-full
        ${className}
      `}
    >
      {/* Main Content with Split Pane */}
      <SplitPane
        primaryContent={
          <div
            data-testid="dashboard-sessions-panel"
          className="
            flex flex-col
            bg-gray-50 dark:bg-gray-900
            border-r border-gray-200 dark:border-gray-700
            h-full
            overflow-hidden
          "
        >
          {/* Panel Header */}
          <div
            className="
              px-4 py-3
              border-b border-gray-200 dark:border-gray-700
              bg-white dark:bg-gray-800
            "
          >
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Sessions
            </h2>
          </div>

          {/* Sessions List */}
          <div
            data-testid="dashboard-sessions-list"
            className="flex-1 overflow-y-auto p-4"
          >
            {(!sessions || sessions.length === 0) && !currentSession ? (
              <div className="text-center py-8">
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
                  No sessions available
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions?.map((session) => (
                  <SessionCard
                    key={`${session.project}-${session.name}`}
                    session={session}
                    isSelected={
                      currentSession?.name === session.name &&
                      currentSession?.project === session.project
                    }
                    onClick={() => handleSessionClick(session)}
                    data-testid={`dashboard-session-card-${session.name}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Panel Footer */}
          {sessions && sessions.length > 0 && (
            <div
              className="
                px-4 py-2
                border-t border-gray-200 dark:border-gray-700
                bg-white dark:bg-gray-800
              "
            >
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
              </p>
            </div>
          )}
        </div>
        }
        secondaryContent={
          <div
            data-testid="dashboard-items-panel"
            className="
              flex flex-col
              bg-white dark:bg-gray-800
              h-full
              overflow-hidden
            "
          >
            {/* Panel Header */}
            <div
              className="
                h-14 px-4
                flex items-center gap-4
                border-b border-gray-200 dark:border-gray-700
                bg-white dark:bg-gray-800
              "
            >
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                {currentSession ? `${currentSession.name}` : 'Items'}
              </h2>
              {currentSession && (
                <>
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      placeholder="Search items..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="
                        w-full
                        px-3 py-1.5
                        text-sm
                        border border-gray-300 dark:border-gray-600
                        rounded-lg
                        bg-white dark:bg-gray-700
                        text-gray-900 dark:text-white
                        placeholder-gray-500 dark:placeholder-gray-400
                        focus:outline-none
                        focus:ring-2 focus:ring-blue-500
                        focus:border-transparent
                      "
                    />
                    <svg
                      className="
                        absolute right-3 top-1/2 -translate-y-1/2
                        w-4 h-4
                        text-gray-400 dark:text-gray-500
                        pointer-events-none
                      "
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50"
                    title="Refresh"
                  >
                    <RefreshIcon
                      className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                    />
                  </button>
                </>
              )}
            </div>

            {/* Items Grid */}
            <div className="flex-1 overflow-hidden">
              {currentSession ? (
                <ItemGrid
                  items={items}
                  selectedItemId={selectedItemId}
                  onItemClick={handleItemClick}
                  showSearch={false}
                  isLoading={false}
                  error={null}
                  data-testid="dashboard-items-grid"
                />
              ) : (
                <div
                  className="
                    flex items-center justify-center
                    h-full
                  "
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
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Select a session to view items
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        }
        direction="horizontal"
        defaultPrimarySize={sessionPanelSplitPosition}
        minPrimarySize={20}
        maxPrimarySize={50}
        onSizeChange={handlePanelResize}
        className="flex-1"
      />
    </div>
  );
};

export default Dashboard;
