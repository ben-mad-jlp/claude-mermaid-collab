/**
 * Root Application Component
 *
 * Main App component that provides:
 * - Theme management with dark/light mode support
 * - Global layout structure with Header, Sidebar, and main content area
 * - Routing between Dashboard and Editor views (based on selection)
 * - Zustand store providers for state management
 * - QuestionPanel overlay for Claude interactions
 * - Error boundary for graceful error handling
 * - Loading states for async operations
 *
 * The app uses a simple state-based routing approach:
 * - Dashboard view: Session and item browsing
 * - DiagramEditor view: Diagram editing with split pane layout
 * - DocumentEditor view: Document editing with markdown preview
 *
 * All views share:
 * - Header with theme toggle
 * - Sidebar with navigation
 * - QuestionPanel overlay
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '@/hooks/useSession';
import { useUIStore } from '@/stores/uiStore';
import { useQuestionStore } from '@/stores/questionStore';
import { useShallow } from 'zustand/react/shallow';

// Import layout components
import Header from '@/components/layout/Header';
import Sidebar, { type NavItem } from '@/components/layout/Sidebar';
import SplitPane from '@/components/layout/SplitPane';
import QuestionPanel from '@/components/question-panel/QuestionPanel';

// Import main view components
import Dashboard from '@/components/dashboard/Dashboard';
import DiagramEditor from '@/components/editors/DiagramEditor';
import DocumentEditor from '@/components/editors/DocumentEditor';

/**
 * View types for the application
 */
type ViewType = 'dashboard' | 'diagram-editor' | 'document-editor';

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
  const { sidebarVisible, sidebarSplitPosition, setSidebarSplitPosition } =
    useUIStore(
      useShallow((state) => ({
        sidebarVisible: state.sidebarVisible,
        sidebarSplitPosition: state.sidebarSplitPosition,
        setSidebarSplitPosition: state.setSidebarSplitPosition,
      }))
    );

  // Session state
  const {
    currentSession,
    selectedDiagramId,
    selectedDocumentId,
    isLoading,
    error: sessionError,
  } = useSession();

  // Question state
  const { currentQuestion } = useQuestionStore();

  // Local state for view management
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');

  // Apply theme to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Handle navigation based on selection
  const handleNavigateToDiagram = useCallback(() => {
    if (selectedDiagramId) {
      setCurrentView('diagram-editor');
    }
  }, [selectedDiagramId]);

  const handleNavigateToDocument = useCallback(() => {
    if (selectedDocumentId) {
      setCurrentView('document-editor');
    }
  }, [selectedDocumentId]);

  const handleBackToDashboard = useCallback(() => {
    setCurrentView('dashboard');
  }, []);

  // Build sidebar navigation items
  const sidebarItems: NavItem[] = useMemo(
    () => [
      {
        id: 'dashboard',
        label: 'Dashboard',
        isActive: currentView === 'dashboard',
        onClick: handleBackToDashboard,
      },
      {
        id: 'current-session',
        label: currentSession?.name || 'No Session',
        isActive:
          currentView === 'diagram-editor' || currentView === 'document-editor',
      },
      {
        id: 'diagram-editor',
        label: 'Diagram Editor',
        isActive: currentView === 'diagram-editor',
        onClick: handleNavigateToDiagram,
      },
      {
        id: 'document-editor',
        label: 'Document Editor',
        isActive: currentView === 'document-editor',
        onClick: handleNavigateToDocument,
      },
    ],
    [currentView, currentSession, handleBackToDashboard, handleNavigateToDiagram, handleNavigateToDocument]
  );

  const handleSidebarResize = useCallback(
    (newSize: number) => {
      setSidebarSplitPosition(newSize);
    },
    [setSidebarSplitPosition]
  );

  // Render the current view
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

    if (sessionError) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="bg-red-50 dark:bg-red-900 p-6 rounded-lg max-w-md">
            <h3 className="text-red-900 dark:text-red-100 font-semibold mb-2">
              Error
            </h3>
            <p className="text-red-700 dark:text-red-200 text-sm">
              {sessionError}
            </p>
          </div>
        </div>
      );
    }

    switch (currentView) {
      case 'diagram-editor':
        return selectedDiagramId ? (
          <DiagramEditor
            diagramId={selectedDiagramId}
          />
        ) : (
          <Dashboard />
        );

      case 'document-editor':
        return selectedDocumentId ? (
          <DocumentEditor
            documentId={selectedDocumentId}
          />
        ) : (
          <Dashboard />
        );

      case 'dashboard':
      default:
        return <Dashboard />;
    }
  };

  return (
    <ErrorBoundary>
      <div
        className={`
          flex flex-col
          min-h-screen
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
                  items={sidebarItems}
                  activeItemId={sidebarItems.find((i) => i.isActive)?.id}
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
