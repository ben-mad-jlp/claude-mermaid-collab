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

import React, { useCallback, useMemo } from 'react';
import { useSession } from '@/hooks/useSession';
import { useUIStore } from '@/stores/uiStore';
import SplitPane from '@/components/layout/SplitPane';
import SessionCard from './SessionCard';
import ItemGrid, { GridItem } from './ItemGrid';

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
    return [...diagramItems, ...documentItems].sort((a, b) => {
      const aTime = a.lastModified || 0;
      const bTime = b.lastModified || 0;
      return bTime - aTime;
    });
  }, [diagrams, documents]);

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
                px-4 py-3
                border-b border-gray-200 dark:border-gray-700
                bg-white dark:bg-gray-800
              "
            >
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {currentSession ? `${currentSession.name} - Items` : 'Items'}
              </h2>
              {currentSession?.phase && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Phase: {currentSession.phase}
                </p>
              )}
            </div>

            {/* Items Grid */}
            <div className="flex-1 overflow-hidden">
              {currentSession ? (
                <ItemGrid
                  items={items}
                  selectedItemId={selectedItemId}
                  onItemClick={handleItemClick}
                  showSearch={true}
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
