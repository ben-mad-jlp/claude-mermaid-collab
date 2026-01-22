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
import { useDataLoader } from '@/hooks/useDataLoader';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useShallow } from 'zustand/react/shallow';
import { api } from '@/lib/api';
import type { Item, ToolbarAction } from '@/types';

// Import layout components
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import SplitPane from '@/components/layout/SplitPane';
import EditorToolbar from '@/components/layout/EditorToolbar';
import QuestionPanel from '@/components/question-panel/QuestionPanel';

// Import unified editor component
import UnifiedEditor from '@/components/editors/UnifiedEditor';

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
    sidebarVisible,
    sidebarSplitPosition,
    setSidebarSplitPosition,
    rawVisible,
    zoomLevel,
    zoomIn,
    zoomOut,
  } = useUIStore(
    useShallow((state) => ({
      sidebarVisible: state.sidebarVisible,
      sidebarSplitPosition: state.sidebarSplitPosition,
      setSidebarSplitPosition: state.setSidebarSplitPosition,
      rawVisible: state.rawVisible,
      zoomLevel: state.zoomLevel,
      zoomIn: state.zoomIn,
      zoomOut: state.zoomOut,
    }))
  );

  // Session state
  const {
    currentSession,
    diagrams,
    documents,
    selectedDiagramId,
    selectedDocumentId,
    updateDiagram,
    updateDocument,
  } = useSessionStore(
    useShallow((state) => ({
      currentSession: state.currentSession,
      diagrams: state.diagrams,
      documents: state.documents,
      selectedDiagramId: state.selectedDiagramId,
      selectedDocumentId: state.selectedDocumentId,
      updateDiagram: state.updateDiagram,
      updateDocument: state.updateDocument,
    }))
  );

  // Data loading
  const { isLoading, error: dataError, loadSessions, loadSessionItems } = useDataLoader();

  // Question state
  const { currentQuestion } = useQuestionStore();

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

  // Update local content when selected item changes
  useEffect(() => {
    if (selectedItem) {
      setLocalContent(selectedItem.content);
    }
  }, [selectedItem?.id, selectedItem?.content]);

  // Auto-save handler
  const handleSave = useCallback(
    async (content: string) => {
      if (!selectedItem || !currentSession) return;

      const project = currentSession.project || '';
      const session = currentSession.name;

      if (selectedItem.type === 'diagram') {
        await api.updateDiagram(project, session, selectedItem.id, content);
        updateDiagram(selectedItem.id, { content });
      } else {
        await api.updateDocument(project, session, selectedItem.id, content);
        updateDocument(selectedItem.id, { content });
      }
    },
    [selectedItem, currentSession, updateDiagram, updateDocument]
  );

  // Auto-save hook
  const { isSaving, hasUnsavedChanges } = useAutoSave(
    localContent,
    handleSave,
    2000
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

  // Load session items when current session changes
  useEffect(() => {
    if (currentSession) {
      const project = currentSession.project || '';
      loadSessionItems(project, currentSession.name);
    }
  }, [currentSession, loadSessionItems]);

  const handleSidebarResize = useCallback(
    (newSize: number) => {
      setSidebarSplitPosition(newSize);
    },
    [setSidebarSplitPosition]
  );

  // Handle content changes from editor
  const handleContentChange = useCallback((content: string) => {
    setLocalContent(content);
  }, []);

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

    // Convert selectedItem for UnifiedEditor (use local content)
    const editorItem = selectedItem
      ? { ...selectedItem, content: localContent }
      : null;

    return (
      <div className="flex flex-col h-full">
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
        <div className="flex-1 overflow-hidden">
          <UnifiedEditor
            item={editorItem}
            rawVisible={rawVisible}
            onContentChange={handleContentChange}
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
        <Header />

        {/* Main Content Area with Sidebar and Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar with Split Pane */}
          <SplitPane
            primaryContent={
              sidebarVisible && (
                <Sidebar
                  className="overflow-y-auto"
                />
              )
            }
            secondaryContent={
              <main
                className={`
                  flex-1
                  overflow-hidden
                  bg-white dark:bg-gray-800
                `}
              >
                {renderMainContent()}
              </main>
            }
            direction="horizontal"
            defaultPrimarySize={sidebarVisible ? sidebarSplitPosition : 0}
            minPrimarySize={0}
            maxPrimarySize={50}
            onSizeChange={handleSidebarResize}
            className="flex-1"
            primaryCollapsible={false}
          />
        </div>

        {/* Question Panel Overlay */}
        {currentQuestion && <QuestionPanel />}

        {/* Loading Overlay */}
        <LoadingOverlay show={isLoading} />
      </div>
    </ErrorBoundary>
  );
};

export default App;
