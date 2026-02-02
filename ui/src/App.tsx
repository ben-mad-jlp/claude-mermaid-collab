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

import React, { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useQuestionStore } from '@/stores/questionStore';
import { useChatStore } from '@/stores/chatStore';
import { useDataLoader } from '@/hooks/useDataLoader';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useSessionPolling } from '@/hooks/useSessionPolling';
import { getWebSocketClient } from '@/lib/websocket';
import { useShallow } from 'zustand/react/shallow';
import { api, generateSessionName, type CachedUIState } from '@/lib/api';
import type { Item, Session, ToolbarAction } from '@/types';

// Import layout components
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import EditorToolbar from '@/components/layout/EditorToolbar';
import { SplitPane } from '@/components/layout/SplitPane';
import { MobileLayout } from '@/components/layout/MobileLayout';
import QuestionPanel from '@/components/question-panel/QuestionPanel';
import { ChatPanel } from '@/components/chat-drawer';

// Import unified editor component
import UnifiedEditor from '@/components/editors/UnifiedEditor';
import type { MermaidPreviewRef } from '@/components/editors/MermaidPreview';

// Import task graph view
import { TaskGraphView } from '@/components/task-graph';

// Import notification components
import { ToastContainer } from '@/components/notifications';
import { requestNotificationPermission, showUserInputNotification } from '@/services/notification-service';

// Import dialogs
import { SessionCleanupDialog, type CleanupAction, CreateSessionDialog, type SessionType } from '@/components/dialogs';

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
  // Mobile detection
  const isMobile = useIsMobile();

  // Theme state and effect
  const { theme } = useTheme();

  // UI state
  const {
    editMode,
    zoomLevel,
    zoomIn,
    zoomOut,
    setZoomLevel,
    chatPanelVisible,
    terminalPanelVisible,
  } = useUIStore(
    useShallow((state) => ({
      editMode: state.editMode,
      zoomLevel: state.zoomLevel,
      zoomIn: state.zoomIn,
      zoomOut: state.zoomOut,
      setZoomLevel: state.setZoomLevel,
      chatPanelVisible: state.chatPanelVisible,
      terminalPanelVisible: state.terminalPanelVisible,
    }))
  );

  // Show chat/terminal panel area when either is visible
  const showSecondaryPanel = chatPanelVisible || terminalPanelVisible;

  // Session state
  const {
    sessions,
    currentSession,
    setCurrentSession,
    diagrams,
    documents,
    wireframes,
    selectedDiagramId,
    selectedDocumentId,
    selectedWireframeId,
    taskGraphSelected,
    updateDiagram,
    updateDocument,
    updateWireframe,
    addDiagram,
    addDocument,
    addWireframe,
    removeDiagram,
    removeDocument,
    removeWireframe,
    setPendingDiff,
    setCollabState,
  } = useSessionStore(
    useShallow((state) => ({
      sessions: state.sessions,
      currentSession: state.currentSession,
      setCurrentSession: state.setCurrentSession,
      diagrams: state.diagrams,
      documents: state.documents,
      wireframes: state.wireframes,
      selectedDiagramId: state.selectedDiagramId,
      selectedDocumentId: state.selectedDocumentId,
      selectedWireframeId: state.selectedWireframeId,
      taskGraphSelected: state.taskGraphSelected,
      updateDiagram: state.updateDiagram,
      updateDocument: state.updateDocument,
      updateWireframe: state.updateWireframe,
      addDiagram: state.addDiagram,
      addDocument: state.addDocument,
      addWireframe: state.addWireframe,
      removeDiagram: state.removeDiagram,
      removeDocument: state.removeDocument,
      removeWireframe: state.removeWireframe,
      setPendingDiff: state.setPendingDiff,
      setCollabState: state.setCollabState,
    }))
  );

  // Data loading
  const { isLoading, error: dataError, loadSessions, loadSessionItems } = useDataLoader();

  // Ref for MermaidPreview imperative methods
  const mermaidPreviewRef = useRef<MermaidPreviewRef>(null);

  // Center and fit callbacks
  const handleCenter = useCallback(() => {
    mermaidPreviewRef.current?.center();
  }, []);

  const handleFitToView = useCallback(() => {
    mermaidPreviewRef.current?.fitToView();
  }, []);

  // Inline diff state for document history viewing (replaces modal)
  const [historyDiff, setHistoryDiff] = useState<{
    timestamp: string;
    historicalContent: string;
    viewMode: 'inline' | 'side-by-side';
    compareMode: 'vs-current' | 'vs-previous';
    previousContent?: string; // Content of version before selected
  } | null>(null);

  // Handle history version selection from EditorToolbar
  const handleHistoryVersionSelect = useCallback((
    timestamp: string,
    content: string,
    previousContent?: string
  ) => {
    if (timestamp === 'current') {
      setHistoryDiff(null);
      return;
    }
    setHistoryDiff(prev => ({
      timestamp,
      historicalContent: content,
      viewMode: prev?.viewMode ?? 'inline',
      compareMode: prev?.compareMode ?? 'vs-current',
      previousContent,
    }));
  }, []);

  // Handle history settings changes
  const handleHistorySettingsChange = useCallback((
    viewMode: 'inline' | 'side-by-side',
    compareMode: 'vs-current' | 'vs-previous'
  ) => {
    setHistoryDiff(prev => prev ? { ...prev, viewMode, compareMode } : null);
  }, []);

  // Clear history diff when selected item changes
  const handleClearHistoryDiff = useCallback(() => {
    setHistoryDiff(null);
  }, []);

  // Diagram history preview state
  const [diagramHistoryPreview, setDiagramHistoryPreview] = useState<{
    timestamp: string;
    historicalContent: string;
  } | null>(null);

  // Handle diagram history version selection
  const handleDiagramHistorySelect = useCallback((timestamp: string, content: string) => {
    setDiagramHistoryPreview({ timestamp, historicalContent: content });
  }, []);

  // Clear diagram history preview
  const handleClearDiagramHistoryPreview = useCallback(() => {
    setDiagramHistoryPreview(null);
  }, []);

  // Revert diagram to historical version
  const handleDiagramRevert = useCallback(() => {
    if (diagramHistoryPreview) {
      setLocalContent(diagramHistoryPreview.historicalContent);
      setDiagramHistoryPreview(null);
    }
  }, [diagramHistoryPreview]);

  // Wireframe history preview state
  const [wireframeHistoryPreview, setWireframeHistoryPreview] = useState<{
    timestamp: string;
    historicalContent: string;
  } | null>(null);

  // Handle wireframe history version selection
  const handleWireframeHistorySelect = useCallback((timestamp: string, content: string) => {
    setWireframeHistoryPreview({ timestamp, historicalContent: content });
  }, []);

  // Clear wireframe history preview
  const handleClearWireframeHistoryPreview = useCallback(() => {
    setWireframeHistoryPreview(null);
  }, []);

  // Revert wireframe to historical version
  const handleWireframeRevert = useCallback(() => {
    if (wireframeHistoryPreview) {
      setLocalContent(wireframeHistoryPreview.historicalContent);
      setWireframeHistoryPreview(null);
    }
  }, [wireframeHistoryPreview]);

  // Registered projects state (projects may exist without sessions)
  const [registeredProjects, setRegisteredProjects] = useState<string[]>([]);

  // Session cleanup dialog state
  const [cleanupSession, setCleanupSession] = useState<Session | null>(null);
  const [isCleanupProcessing, setIsCleanupProcessing] = useState(false);

  // Create session dialog state
  const [createSessionDialog, setCreateSessionDialog] = useState<{
    project: string;
    suggestedName: string;
  } | null>(null);

  // Load registered projects from API
  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        setRegisteredProjects((data.projects || []).map((p: { path: string }) => p.path));
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  }, []);

  // Question state
  const { currentQuestion, receiveQuestion } = useQuestionStore(
    useShallow((state) => ({
      currentQuestion: state.currentQuestion,
      receiveQuestion: state.receiveQuestion,
    }))
  );

  // WebSocket for real-time updates
  const { isConnected, isConnecting } = useWebSocket();

  // Session polling for fallback status sync (dual-channel with WebSocket)
  useSessionPolling(
    currentSession?.project ?? null,
    currentSession?.name ?? null,
    5000
  );

  // Request notification permission on app mount (Item 6)
  useEffect(() => {
    requestNotificationPermission().catch(() => {
      // Silently fail if permission request fails
    });
  }, []);

  // Chat store - no longer need drawer state, ChatPanel is always visible

  // Restore UI state from backend cache (for reconnection recovery)
  const restoreUIState = useCallback(async () => {
    if (!currentSession) return;

    try {
      const cachedUI = await api.getUIState(currentSession.project, currentSession.name);
      if (cachedUI) {
        useChatStore.getState().restoreUIFromCache(cachedUI, currentSession.project, currentSession.name);
      }
    } catch (error) {
      console.error('Failed to restore UI state:', error);
    }
  }, [currentSession]);

  // Subscribe to updates and handle messages
  useEffect(() => {
    const client = getWebSocketClient();

    // Subscribe to updates when connected
    if (isConnected && currentSession) {
      client.subscribe('updates');
      // Restore any cached UI state on reconnection
      restoreUIState();
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
          const { id, name, content, lastModified, project, session } = message as any;
          if (id && name && content !== undefined &&
              currentSession &&
              project === currentSession.project &&
              session === currentSession.name) {
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
          const { id, name, content, lastModified, project, session } = message as any;
          if (id && name && content !== undefined &&
              currentSession &&
              project === currentSession.project &&
              session === currentSession.name) {
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
          const { id, project, session } = message as any;
          if (id &&
              currentSession &&
              project === currentSession.project &&
              session === currentSession.name) {
            removeDiagram(id);
          }
          break;
        }

        case 'document_deleted': {
          // Item 2: Remove document without full refresh
          const { id, project, session } = message as any;
          if (id &&
              currentSession &&
              project === currentSession.project &&
              session === currentSession.name) {
            removeDocument(id);
          }
          break;
        }

        case 'wireframe_created': {
          // Add new wireframe without full refresh
          const { id, name, content, lastModified, project, session } = message as any;
          if (id &&
              currentSession &&
              project === currentSession.project &&
              session === currentSession.name) {
            addWireframe({
              id,
              name: name || id,
              content,
              lastModified: lastModified || Date.now(),
            });
          }
          break;
        }

        case 'wireframe_updated': {
          // Update wireframe without full refresh
          const { id, content, project, session } = message as any;
          if (id &&
              currentSession &&
              project === currentSession.project &&
              session === currentSession.name) {
            updateWireframe(id, { content, lastModified: Date.now() });
          }
          break;
        }

        case 'wireframe_deleted': {
          // Remove wireframe without full refresh
          const { id, project, session } = message as any;
          if (id &&
              currentSession &&
              project === currentSession.project &&
              session === currentSession.name) {
            removeWireframe(id);
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

        case 'ui_render': {
          // Item 3: Handle UI render messages for interactive UI overlays
          const { uiId, project, session, ui, blocking, timestamp } = message as any;

          // Only process if message matches current session
          if (currentSession &&
              project === currentSession.project &&
              session === currentSession.name) {
            useChatStore.getState().addMessage({
              id: uiId,
              type: 'ui_render',
              ui,
              blocking: blocking ?? true,
              timestamp: timestamp || Date.now(),
              responded: false,
              project,
              session,
            });

            // Item 6: Show browser notification for blocking messages
            if (blocking ?? true) {
              showUserInputNotification(uiId);
            }
          }
          break;
        }

        case 'session_state_updated': {
          // Item 3: Handle task quantity auto updating via WebSocket
          const { project, session, state } = message as any;

          // Only process if message matches current session
          if (currentSession &&
              project === currentSession.project &&
              session === currentSession.name) {
            setCollabState(state);
          }
          break;
        }

        case 'session_created': {
          // Handle session creation - only auto-select if no session currently active
          const { project, session } = message as any;
          loadSessions().then(() => {
            const { currentSession: existingSession } = useSessionStore.getState();

            // Only auto-select if no session currently selected (preserve user's context)
            if (!existingSession) {
              const freshSessions = useSessionStore.getState().sessions;
              const newSession = freshSessions.find(s => s.project === project && s.name === session);
              if (newSession) {
                setCurrentSession(newSession);
              }
            }
          });
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
  }, [isConnected, currentSession, updateDiagram, updateDocument, updateWireframe, addDiagram, addDocument, addWireframe, removeDiagram, removeDocument, removeWireframe, setPendingDiff, setCollabState, receiveQuestion, restoreUIState]);

  // Compute selected item from diagrams/documents/wireframes
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
    if (selectedWireframeId) {
      const wireframe = wireframes.find((w) => w.id === selectedWireframeId);
      if (wireframe) {
        return {
          id: wireframe.id,
          name: wireframe.name,
          type: 'wireframe' as const,
          content: wireframe.content ?? '',
          lastModified: wireframe.lastModified ?? Date.now(),
        };
      }
    }
    return null;
  }, [diagrams, documents, wireframes, selectedDiagramId, selectedDocumentId, selectedWireframeId]);

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

  // Clear history state when selected item changes
  useEffect(() => {
    setHistoryDiff(null);
    setDiagramHistoryPreview(null);
    setWireframeHistoryPreview(null);
  }, [selectedItem?.id]);

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

  // Update page title with project and session name
  useEffect(() => {
    if (currentSession) {
      const projectName = currentSession.project.split('/').pop() || currentSession.project;
      document.title = `${projectName} / ${currentSession.name} - Mermaid Collab`;
    } else {
      document.title = 'Mermaid Collab';
    }
  }, [currentSession]);

  // Load sessions and projects on mount
  useEffect(() => {
    loadSessions();
    loadProjects();
  }, [loadSessions, loadProjects]);

  // Auto-select first session only on initial load (not when user clears session)
  const hasAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (sessions.length > 0 && !currentSession && !hasAutoSelectedRef.current) {
      hasAutoSelectedRef.current = true;
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

  // Handle creating a new session in a specific project
  const handleCreateSession = useCallback((project: string) => {
    const suggestedName = generateSessionName();
    setCreateSessionDialog({ project, suggestedName });
  }, []);

  // Handle create session dialog confirmation
  const handleCreateSessionConfirm = useCallback(async (name: string, type: SessionType) => {
    if (!createSessionDialog) return;

    try {
      const newSession = await api.createSession(createSessionDialog.project, name, type);
      // Refresh sessions list and select the new session
      await loadSessions();
      setCurrentSession(newSession);
    } catch (error) {
      console.error('Failed to create session:', error);
    } finally {
      setCreateSessionDialog(null);
    }
  }, [createSessionDialog, loadSessions, setCurrentSession]);

  // Handle create session dialog close
  const handleCreateSessionClose = useCallback(() => {
    setCreateSessionDialog(null);
  }, []);

  // Handle adding a new project
  const handleAddProject = useCallback(async () => {
    const projectPath = window.prompt('Enter project path:', '/Users');

    // User cancelled or entered empty path
    if (!projectPath?.trim()) {
      return;
    }

    try {
      // Register the project via the projects API
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || 'Failed to add project');
        return;
      }

      // Refresh projects and sessions lists
      await loadProjects();
      await loadSessions();
    } catch (error) {
      console.error('Failed to add project:', error);
      alert('Failed to add project');
    }
  }, [loadSessions, loadProjects]);

  // Handle refreshing everything - projects, sessions list, and current session items
  const handleRefreshAll = useCallback(async () => {
    // Refresh projects and sessions list
    await loadProjects();
    await loadSessions();

    // Refresh current session items if a session is selected
    if (currentSession) {
      const project = currentSession.project || '';
      await loadSessionItems(project, currentSession.name);
    }
  }, [loadProjects, loadSessions, loadSessionItems, currentSession]);

  // Handle opening the session cleanup dialog
  const handleDeleteSession = useCallback((session: Session) => {
    setCleanupSession(session);
  }, []);

  // Handle cleanup action from dialog
  const handleCleanupAction = useCallback(async (action: CleanupAction) => {
    if (!cleanupSession) return;

    setIsCleanupProcessing(true);

    try {
      switch (action) {
        case 'archive':
          // Archive and delete session
          await api.archiveSession(cleanupSession.project, cleanupSession.name, {
            deleteSession: true,
            timestamp: false,
          });
          break;

        case 'delete':
          // Delete without archiving
          await api.deleteSession(cleanupSession.project, cleanupSession.name);
          break;

        case 'keep':
          // Do nothing, just close the dialog
          break;

        case 'archive-continue':
          // Archive with timestamp, keep session
          await api.archiveSession(cleanupSession.project, cleanupSession.name, {
            deleteSession: false,
            timestamp: true,
          });
          break;
      }

      // Clear current session if we deleted/archived it
      if (action === 'archive' || action === 'delete') {
        if (currentSession?.project === cleanupSession.project &&
            currentSession?.name === cleanupSession.name) {
          setCurrentSession(null);
        }
      }

      // Refresh sessions list
      await loadSessions();
    } catch (error) {
      console.error('Failed to process cleanup action:', error);
    } finally {
      setIsCleanupProcessing(false);
      setCleanupSession(null);
    }
  }, [cleanupSession, currentSession, loadSessions, setCurrentSession]);

  // Handle closing the cleanup dialog
  const handleCleanupClose = useCallback(() => {
    if (!isCleanupProcessing) {
      setCleanupSession(null);
    }
  }, [isCleanupProcessing]);

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

    // Render task graph view when selected
    if (taskGraphSelected && currentSession) {
      return (
        <div className="flex flex-col h-full min-h-0">
          {/* Toolbar for Task Graph */}
          <EditorToolbar
            itemName="Task Graph"
            hasUnsavedChanges={false}
            onUndo={() => {}}
            onRedo={() => {}}
            canUndo={false}
            canRedo={false}
            zoom={zoomLevel}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            overflowActions={[]}
            showZoom={true}
            onCenter={handleCenter}
            onFitToView={handleFitToView}
            itemType="diagram"
          />

          {/* Task Graph View */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <TaskGraphView
              project={currentSession.project}
              session={currentSession.name}
            />
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
          showZoom={selectedItem?.type !== 'document'}
          onCenter={selectedItem?.type === 'diagram' ? handleCenter : undefined}
          onFitToView={selectedItem?.type === 'diagram' ? handleFitToView : undefined}
          itemType={selectedItem?.type}
          documentId={selectedItem?.type === 'document' ? selectedItem.id : undefined}
          documentContent={selectedItem?.type === 'document' ? effectiveContent : undefined}
          onHistoryVersionSelect={selectedItem?.type === 'document' ? handleHistoryVersionSelect : undefined}
          historyDiff={selectedItem?.type === 'document' ? historyDiff : null}
          onClearHistoryDiff={handleClearHistoryDiff}
          onHistorySettingsChange={selectedItem?.type === 'document' ? handleHistorySettingsChange : undefined}
          diagramId={selectedItem?.type === 'diagram' ? selectedItem.id : undefined}
          onDiagramHistorySelect={selectedItem?.type === 'diagram' ? handleDiagramHistorySelect : undefined}
          wireframeId={selectedItem?.type === 'wireframe' ? selectedItem.id : undefined}
          onWireframeHistorySelect={selectedItem?.type === 'wireframe' ? handleWireframeHistorySelect : undefined}
        />

        {/* Unified Editor */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <UnifiedEditor
            item={editorItem}
            editMode={editMode}
            project={currentSession?.project}
            session={currentSession?.name}
            onContentChange={handleContentChange}
            zoomLevel={zoomLevel}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onSetZoom={setZoomLevel}
            previewRef={mermaidPreviewRef}
            historyDiff={selectedItem?.type === 'document' ? historyDiff : null}
            onClearHistoryDiff={handleClearHistoryDiff}
            diagramHistoryPreview={selectedItem?.type === 'diagram' ? diagramHistoryPreview : null}
            onDiagramRevert={handleDiagramRevert}
            onClearDiagramHistoryPreview={handleClearDiagramHistoryPreview}
            wireframeHistoryPreview={selectedItem?.type === 'wireframe' ? wireframeHistoryPreview : null}
            onWireframeRevert={handleWireframeRevert}
            onClearWireframeHistoryPreview={handleClearWireframeHistoryPreview}
          />
        </div>
      </div>
    );
  };

  // Render mobile layout for mobile viewports, desktop layout for desktop viewports
  if (isMobile) {
    return (
      <ErrorBoundary>
        <MobileLayout
          sessions={sessions}
          registeredProjects={registeredProjects}
          handlers={{
            onSessionSelect: handleSessionSelect,
            onRefreshSessions: handleRefreshAll,
            onCreateSession: handleCreateSession,
            onAddProject: handleAddProject,
            onDeleteSession: handleDeleteSession,
          }}
          isConnected={isConnected}
          isConnecting={isConnecting}
        />

        {/* Question Panel Overlay - renders on top of mobile layout */}
        {currentQuestion && <QuestionPanel />}

        {/* Session Cleanup Dialog */}
        {cleanupSession && (
          <SessionCleanupDialog
            session={cleanupSession}
            onAction={handleCleanupAction}
            onClose={handleCleanupClose}
            isProcessing={isCleanupProcessing}
          />
        )}

        {/* Create Session Dialog */}
        {createSessionDialog && (
          <CreateSessionDialog
            suggestedName={createSessionDialog.suggestedName}
            onConfirm={handleCreateSessionConfirm}
            onClose={handleCreateSessionClose}
          />
        )}

        {/* Notification Toast Container */}
        <ToastContainer />
      </ErrorBoundary>
    );
  }

  // Desktop layout
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
          registeredProjects={registeredProjects}
          onSessionSelect={handleSessionSelect}
          onRefreshSessions={handleRefreshAll}
          onCreateSession={handleCreateSession}
          onAddProject={handleAddProject}
          onDeleteSession={handleDeleteSession}
          isConnected={isConnected}
          isConnecting={isConnecting}
        />

        {/* Main Content Area with Sidebar, Content, and ChatPanel */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Fixed-width Sidebar */}
          <Sidebar className="h-full" />

          {/* Main Content - with or without ChatPanel split */}
          {showSecondaryPanel ? (
            <SplitPane
              direction="horizontal"
              defaultPrimarySize={75}
              minPrimarySize={20}
              minSecondarySize={15}
              storageId="main-chat-split"
              primaryContent={
                <main
                  className={`
                    h-full
                    min-h-0
                    overflow-hidden
                    bg-white dark:bg-gray-800
                  `}
                >
                  {renderMainContent()}
                </main>
              }
              secondaryContent={
                <ChatPanel className="h-full" />
              }
            />
          ) : (
            <main
              className={`
                flex-1
                h-full
                min-h-0
                overflow-hidden
                bg-white dark:bg-gray-800
              `}
            >
              {renderMainContent()}
            </main>
          )}
        </div>

        {/* Question Panel Overlay */}
        {currentQuestion && <QuestionPanel />}

        {/* Loading Overlay */}
        <LoadingOverlay show={isLoading} />

        {/* Session Cleanup Dialog */}
        {cleanupSession && (
          <SessionCleanupDialog
            session={cleanupSession}
            onAction={handleCleanupAction}
            onClose={handleCleanupClose}
            isProcessing={isCleanupProcessing}
          />
        )}

        {/* Create Session Dialog */}
        {createSessionDialog && (
          <CreateSessionDialog
            suggestedName={createSessionDialog.suggestedName}
            onConfirm={handleCreateSessionConfirm}
            onClose={handleCreateSessionClose}
          />
        )}

        {/* Notification Toast Container */}
        <ToastContainer />
      </div>
    </ErrorBoundary>
  );
};

export default App;
