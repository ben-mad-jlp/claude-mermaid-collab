/**
 * Root Application Component
 *
 * Main App component that provides:
 * - Theme management with dark/light mode support
 * - Global layout structure with Header, Sidebar, and main content area
 * - Unified editor view for diagrams and documents
 * - Zustand store providers for state management
 * - QuestionPanel overlay for Claude interactions
 * - Error boundary for graceful error handling
 * - Loading states for async operations
 * - Auto-save functionality with 2s debounce
 *
 * The app uses a unified layout approach:
 * - Header with session dropdown and raw toggle
 * - Sidebar with items list (docs/diagrams sorted by last updated)
 * - Main area with EditorToolbar and UnifiedEditor
 *
 * All views share:
 * - Header with theme toggle and raw panel toggle
 * - Sidebar with items and search
 * - QuestionPanel overlay
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useQuestionStore } from '@/stores/questionStore';
import { useChatStore } from '@/stores/chatStore';
import { useDataLoader } from '@/hooks/useDataLoader';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useWebSocket } from '@/hooks/useWebSocket';
import { getWebSocketClient } from '@/lib/websocket';
import { useShallow } from 'zustand/react/shallow';
import { api } from '@/lib/api';
import type { Item, Session, ToolbarAction } from '@/types';

// Import layout components
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import EditorToolbar from '@/components/layout/EditorToolbar';
import QuestionPanel from '@/components/question-panel/QuestionPanel';
import { ChatToggle, ChatDrawer } from '@/components/chat-drawer';

// Import unified editor component
import UnifiedEditor from '@/components/editors/UnifiedEditor';

// Import notification components
import { ToastContainer } from '@/components/notifications';

/**
 * Error Boundary Component
 * Catches errors in child components and displays fallback UI
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-white dark:bg-gray-900">
          <div className="text-center px-4">
            <h1 className="text-3xl font-bold text-red-600 mb-4">
              Something went wrong
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Loading Overlay Component
 * Displays a loading spinner while content is being loaded
 */
const LoadingOverlay: React.FC<{ show: boolean }> = ({ show }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-8">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-gray-900 dark:text-white">Loading...</p>
        </div>
      </div>
    </div>
  );
};

/**
 * Main App Component
 */
const App: React.FC = () => {
  // Theme state and effect
  const { theme } = useTheme();

  // UI state
  const {
    editMode,
    zoomLevel,
    zoomIn,
    zoomOut,
  } = useUIStore(
    useShallow((state) => ({
      editMode: state.editMode,
      zoomLevel: state.zoomLevel,
      zoomIn: state.zoomIn,
      zoomOut: state.zoomOut,
    }))
  );

  // Session state
  const {
    sessions,
    currentSession,
    setCurrentSession,
    diagrams,
    documents,
    selectedDiagramId,
    selectedDocumentId,
    updateDiagram,
    updateDocument,
    addDiagram,
    addDocument,
    removeDiagram,
    removeDocument,
    setPendingDiff,
  } = useSessionStore(
    useShallow((state) => ({
      sessions: state.sessions,
      currentSession: state.currentSession,
      setCurrentSession: state.setCurrentSession,
      diagrams: state.diagrams,
      documents: state.documents,
      selectedDiagramId: state.selectedDiagramId,
      selectedDocumentId: state.selectedDocumentId,
      updateDiagram: state.updateDiagram,
      updateDocument: state.updateDocument,
      addDiagram: state.addDiagram,
      addDocument: state.addDocument,
      removeDiagram: state.removeDiagram,
      removeDocument: state.removeDocument,
      setPendingDiff: state.setPendingDiff,
    }))
  );

  // Data loading
  const { isLoading, error: dataError, loadSessions, loadSessionItems } = useDataLoader();

  // Question state
  const { currentQuestion, receiveQuestion } = useQuestionStore(
    useShallow((state) => ({
      currentQuestion: state.currentQuestion,
      receiveQuestion: state.receiveQuestion,
    }))
  );

  // WebSocket for real-time updates
  const { isConnected, isConnecting } = useWebSocket();

  // Chat store for drawer state
  const { isOpen: isChatOpen, unreadCount, setOpen: setChatOpen } = useChatStore(
    useShallow((state) => ({
      isOpen: state.isOpen,
      unreadCount: state.unreadCount,
      setOpen: state.setOpen,
    }))
  );

  // Subscribe to updates and handle messages
  useEffect(() => {
    const client = getWebSocketClient();

    // Subscribe to updates when connected
    if (isConnected && currentSession) {
      client.subscribe('updates');
    }

    // Handle incoming messages with incremental updates (Item 2 & 9)
    const subscription = client.onMessage((message) => {
      if (!currentSession) return;

      switch (message.type) {
        case 'diagram_updated': {
          // Item 2: Use incremental update instead of full refresh
          const { id, content } = message as any;
          if (id && content !== undefined) {
            updateDiagram(id, { content, lastModified: Date.now() });
          }
          break;
        }

        case 'document_updated': {
          // Item 2 + Item 5: Incremental update + diff state
          const { id, content, patchInfo } = message as any;
          if (id && content !== undefined) {
            if (patchInfo) {
              setPendingDiff({
                documentId: id,
                oldContent: patchInfo.oldString || '',
                newContent: patchInfo.newString || '',
                timestamp: Date.now(),
              });
            }
            updateDocument(id, { content, lastModified: Date.now() });
          }
          break;
        }

        case 'diagram_created': {
          // Item 2: Add new diagram without full refresh
          const { id, name, content, lastModified } = message as any;
          if (id && name && content !== undefined) {
            addDiagram({
              id,
              name,
              content,
              lastModified: lastModified || Date.now(),
            } as any);
          }
          break;
        }

        case 'document_created': {
          // Item 2: Add new document without full refresh
          const { id, name, content, lastModified } = message as any;
          if (id && name && content !== undefined) {
            addDocument({
              id,
              name,
              content,
              lastModified: lastModified || Date.now(),
            } as any);
          }
          break;
        }

        case 'diagram_deleted': {
          // Item 2: Remove diagram without full refresh
          const { id } = message as any;
          if (id) {
            removeDiagram(id);
          }
          break;
        }

        case 'document_deleted': {
          // Item 2: Remove document without full refresh
          const { id } = message as any;
          if (id) {
            removeDocument(id);
          }
          break;
        }

        case 'claude_question': {
          // Item 9: Handle incoming Claude Code questions
          const { question } = message as any;
          if (question && question.id && question.text) {
            receiveQuestion(question);
          }
          break;
        }

        default:
          // Unknown message type - log for debugging
          console.debug('Unknown WebSocket message type:', message.type);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isConnected, currentSession, updateDiagram, updateDocument, addDiagram, addDocument, removeDiagram, removeDocument, setPendingDiff, receiveQuestion]);

  // Compute selected item from diagrams/documents
  const selectedItem: Item | null = useMemo(() => {
    if (selectedDiagramId) {
      const diagram = diagrams.find((d) => d.id === selectedDiagramId);
      if (diagram) {
        return {
          id: diagram.id,
          name: diagram.name,
          type: 'diagram' as const,
          content: diagram.content,
          lastModified: diagram.lastModified,
        };
      }
    }
    if (selectedDocumentId) {
      const doc = documents.find((d) => d.id === selectedDocumentId);
      if (doc) {
        return {
          id: doc.id,
          name: doc.name,
          type: 'document' as const,
          content: doc.content,
          lastModified: doc.lastModified,
        };
      }
    }
    return null;
  }, [diagrams, documents, selectedDiagramId, selectedDocumentId]);

  // Track local content for auto-save
  const [localContent, setLocalContent] = React.useState<string>('');

  // Item 4: Use useMemo to compute effective content based on selectedItem
  // This ensures type switches get fresh content immediately without async race condition
  const effectiveContent = useMemo(() => {
    if (!selectedItem) return '';
    return selectedItem.content;
  }, [selectedItem?.id, selectedItem?.content]);

  // Update local content when selected item changes
  useEffect(() => {
    if (selectedItem) {
      setLocalContent(selectedItem.content);
    }
  }, [selectedItem?.id, selectedItem?.content]);

  // Auto-save handler - uses WebSocket to persist changes
  const handleSave = useCallback(
    async (content: string) => {
      if (!selectedItem || !currentSession) return;

      const project = currentSession.project || '';
      const session = currentSession.name;

      // Update local store immediately
      if (selectedItem.type === 'diagram') {
        updateDiagram(selectedItem.id, { content });
      } else {
        updateDocument(selectedItem.id, { content });
      }

      // Send update via WebSocket if connected
      const client = getWebSocketClient();
      if (client.isConnected()) {
        client.send({
          type: selectedItem.type === 'diagram' ? 'update_diagram' : 'update_document',
          project,
          session,
          id: selectedItem.id,
          content,
        });
      }
    },
    [selectedItem, currentSession, updateDiagram, updateDocument]
  );

  // Auto-save hook - pass selectedItem?.id to reset when switching items
  const { isSaving, hasUnsavedChanges } = useAutoSave(
    localContent,
    handleSave,
    2000,
    selectedItem?.id // Reset auto-save state when item changes
  );

  // Apply theme to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Auto-select first session when sessions load
  useEffect(() => {
    if (sessions.length > 0 && !currentSession) {
      setCurrentSession(sessions[0]);
    }
  }, [sessions, currentSession, setCurrentSession]);

  // Load session items when current session changes
  useEffect(() => {
    if (currentSession) {
      const project = currentSession.project || '';
      loadSessionItems(project, currentSession.name);
    }
  }, [currentSession, loadSessionItems]);

  // Handle content changes from editor
  const handleContentChange = useCallback((content: string) => {
    setLocalContent(content);
  }, []);

  // Handle session selection from Header dropdown
  const handleSessionSelect = useCallback(
    (session: Session) => {
      setCurrentSession(session);
    },
    [setCurrentSession]
  );

  // Build overflow actions for toolbar
  const overflowActions: ToolbarAction[] = useMemo(() => {
    if (!selectedItem) return [];

    const actions: ToolbarAction[] = [
      {
        id: 'copy',
        label: 'Copy',
        icon: (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        ),
        onClick: () => navigator.clipboard.writeText(localContent),
      },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        ),
        onClick: () => {
          if (currentSession) {
            const project = currentSession.project || '';
            loadSessionItems(project, currentSession.name);
          }
        },
      },
    ];

    // Diagram-specific actions
    if (selectedItem.type === 'diagram') {
      actions.push({
        id: 'format',
        label: 'Format',
        icon: (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="21" y1="10" x2="3" y2="10" />
            <line x1="21" y1="6" x2="3" y2="6" />
            <line x1="21" y1="14" x2="3" y2="14" />
            <line x1="21" y1="18" x2="3" y2="18" />
          </svg>
        ),
        onClick: () => {
          // Format action placeholder
        },
        disabled: true,
      });
      actions.push({
        id: 'export-image',
        label: 'Export Image',
        icon: (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        ),
        onClick: () => {
          // Export image placeholder
        },
        disabled: true,
      });
    }

    return actions;
  }, [selectedItem, localContent, currentSession, loadSessionItems]);

  // Render loading state
  const renderMainContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading...</p>
          </div>
        </div>
      );
    }

    if (dataError) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="bg-red-50 dark:bg-red-900 p-6 rounded-lg max-w-md">
            <h3 className="text-red-900 dark:text-red-100 font-semibold mb-2">
              Error
            </h3>
            <p className="text-red-700 dark:text-red-200 text-sm">
              {dataError}
            </p>
          </div>
        </div>
      );
    }

    // Item 4: Use effectiveContent to avoid type mismatch during item switches
    // If localContent hasn't updated yet via useEffect, use the fresh effectiveContent
    // This prevents rendering diagram with markdown content (or vice versa)
    const editorItem = selectedItem
      ? { ...selectedItem, content: effectiveContent || localContent }
      : null;

    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Editor Toolbar */}
        <EditorToolbar
          itemName={selectedItem?.name || ''}
          hasUnsavedChanges={hasUnsavedChanges || isSaving}
          onUndo={() => {}} // TODO: Implement undo/redo
          onRedo={() => {}}
          canUndo={false}
          canRedo={false}
          zoom={zoomLevel}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          overflowActions={overflowActions}
        />

        {/* Unified Editor */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <UnifiedEditor
            item={editorItem}
            editMode={editMode}
            onContentChange={handleContentChange}
            zoomLevel={zoomLevel}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />
        </div>
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <div
        className={`
          flex flex-col
          h-screen
          bg-white dark:bg-gray-900
          text-gray-900 dark:text-gray-100
        `}
      >
        {/* Header */}
        <Header
          sessions={sessions}
          onSessionSelect={handleSessionSelect}
          isConnected={isConnected}
          isConnecting={isConnecting}
        />

        {/* Main Content Area with Sidebar and Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Fixed-width Sidebar */}
          <Sidebar className="h-full" />

          {/* Main Content */}
          <main
            className={`
              flex-1
              min-h-0
              overflow-hidden
              bg-white dark:bg-gray-800
            `}
          >
            {renderMainContent()}
          </main>
        </div>

        {/* Chat Toggle Button */}
        <ChatToggle
          onClick={() => setChatOpen(!isChatOpen)}
          unreadCount={unreadCount}
          isOpen={isChatOpen}
        />

        {/* Chat Drawer */}
        <ChatDrawer
          isOpen={isChatOpen}
          onClose={() => setChatOpen(false)}
        />

        {/* Question Panel Overlay */}
        {currentQuestion && <QuestionPanel />}

        {/* Loading Overlay */}
        <LoadingOverlay show={isLoading} />

        {/* Notification Toast Container */}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
};

export default App;
