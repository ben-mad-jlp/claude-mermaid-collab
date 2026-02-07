/**
 * Header Component
 *
 * Top navigation bar with:
 * - Logo and application title
 * - Theme toggle (light/dark mode)
 * - Project selector dropdown
 * - Session selector dropdown
 *
 * Integrates with useTheme and useSession hooks for state management.
 */

import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '@/hooks/useSession';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';
import { SessionStatusPanel } from '@/components/SessionStatusPanel';
import { Session } from '@/types';

export interface HeaderProps {
  /** Available sessions to select from */
  sessions?: Session[];
  /** Registered projects (may have no sessions yet) */
  registeredProjects?: string[];
  /** Callback when a session is selected */
  onSessionSelect?: (session: Session) => void;
  /** Callback to refresh sessions list */
  onRefreshSessions?: () => void;
  /** Callback to create a new session */
  onCreateSession?: (project: string) => void;
  /** Callback to add a new project */
  onAddProject?: () => void;
  /** Callback to delete a session */
  onDeleteSession?: (session: Session) => void;
  /** WebSocket connection status */
  isConnected?: boolean;
  /** Whether WebSocket is connecting */
  isConnecting?: boolean;
  /** Optional custom class name */
  className?: string;
}

/**
 * Header component with logo, theme toggle, project selector, and session selector
 */
export const Header: React.FC<HeaderProps> = ({
  sessions = [],
  registeredProjects = [],
  onSessionSelect,
  onRefreshSessions,
  onCreateSession,
  onAddProject,
  onDeleteSession,
  isConnected = false,
  isConnecting = false,
  className = '',
}) => {
  const { theme, toggleTheme } = useTheme();
  const { currentSession } = useSession();
  const { editMode, toggleEditMode, chatPanelVisible, toggleChatPanel, terminalPanelVisible, toggleTerminalPanel } = useUIStore(
    useShallow((state) => ({
      editMode: state.editMode,
      toggleEditMode: state.toggleEditMode,
      chatPanelVisible: state.chatPanelVisible,
      toggleChatPanel: state.toggleChatPanel,
      terminalPanelVisible: state.terminalPanelVisible,
      toggleTerminalPanel: state.toggleTerminalPanel,
    }))
  );

  const { todosSelected, todos, selectTodos, setTodos } = useSessionStore(
    useShallow((state) => ({
      todosSelected: state.todosSelected,
      todos: state.todos,
      selectTodos: state.selectTodos,
      setTodos: state.setTodos,
    }))
  );

  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isSessionDropdownOpen, setIsSessionDropdownOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const sessionDropdownRef = useRef<HTMLDivElement>(null);

  // Get unique projects from sessions and registered projects
  const projects = useMemo(() => {
    const projectSet = new Set<string>();
    // Add projects from sessions
    sessions.forEach((s) => {
      if (s.project) projectSet.add(s.project);
    });
    // Add registered projects (may have no sessions yet)
    registeredProjects.forEach((p) => projectSet.add(p));
    return Array.from(projectSet).sort();
  }, [sessions, registeredProjects]);

  // Get sessions for selected project (exclude todo-linked sessions)
  const projectSessions = useMemo(() => {
    if (!selectedProject) return [];
    const todoSessionNames = new Set(todos.map(t => t.sessionName));
    return sessions.filter((s) => s.project === selectedProject && !todoSessionNames.has(s.name));
  }, [sessions, selectedProject, todos]);

  // Sync selectedProject with currentSession (only when currentSession changes)
  useEffect(() => {
    console.log('[Header] Sync effect - currentSession?.project:', currentSession?.project, 'selectedProject:', selectedProject);
    if (currentSession?.project) {
      console.log('[Header] Sync effect - setting selectedProject to:', currentSession.project);
      setSelectedProject(currentSession.project);
    }
    // Only depend on currentSession.project, not selectedProject
    // This allows user to manually select a different project without being reverted
  }, [currentSession?.project]);

  // Auto-select first project if none selected
  useEffect(() => {
    console.log('[Header] Auto-select effect - selectedProject:', selectedProject, 'projects.length:', projects.length, 'currentSession?.project:', currentSession?.project);
    if (!selectedProject && projects.length > 0) {
      // Prefer current session's project, otherwise first project
      if (currentSession?.project) {
        console.log('[Header] Auto-select: using currentSession.project:', currentSession.project);
        setSelectedProject(currentSession.project);
      } else {
        console.log('[Header] Auto-select: using first project:', projects[0]);
        setSelectedProject(projects[0]);
      }
    }
  }, [projects, selectedProject, currentSession?.project]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(event.target as Node)) {
        setIsSessionDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Close dropdowns on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsProjectDropdownOpen(false);
        setIsSessionDropdownOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleProjectSelect = useCallback((project: string) => {
    console.log('[Header] handleProjectSelect called with:', project);
    console.log('[Header] sessions in project:', sessions.filter((s) => s.project === project).length);
    console.log('[Header] currentSession:', currentSession?.project, currentSession?.name);
    setSelectedProject(project);
    setIsProjectDropdownOpen(false);
    // If there's a session in this project, auto-select the first one
    const sessionsInProject = sessions.filter((s) => s.project === project);
    if (sessionsInProject.length > 0 && onSessionSelect) {
      console.log('[Header] Auto-selecting first session:', sessionsInProject[0].name);
      onSessionSelect(sessionsInProject[0]);
    } else if (currentSession && currentSession.project !== project) {
      // Clear current session when switching to a project with no sessions
      // This prevents the sync effect from reverting the selection
      console.log('[Header] Clearing currentSession (switching to project with no sessions)');
      onSessionSelect?.(null as unknown as Session);
    }
  }, [sessions, onSessionSelect, currentSession]);

  const handleSessionClick = useCallback(
    (session: Session) => {
      onSessionSelect?.(session);
      setIsSessionDropdownOpen(false);
    },
    [onSessionSelect]
  );

  const handleThemeToggle = useCallback(() => {
    toggleTheme();
  }, [toggleTheme]);

  const handleEditModeToggle = useCallback(() => {
    toggleEditMode();
  }, [toggleEditMode]);

  const handleChatToggle = useCallback(() => {
    toggleChatPanel();
  }, [toggleChatPanel]);

  const handleTerminalToggle = useCallback(() => {
    toggleTerminalPanel();
  }, [toggleTerminalPanel]);

  const handleRefreshSessions = useCallback(() => {
    onRefreshSessions?.();
  }, [onRefreshSessions]);

  const handleAddProject = useCallback(() => {
    setIsProjectDropdownOpen(false);
    onAddProject?.();
  }, [onAddProject]);

  const handleCreateSession = useCallback(() => {
    setIsSessionDropdownOpen(false);
    if (selectedProject) {
      onCreateSession?.(selectedProject);
    }
  }, [onCreateSession, selectedProject]);

  const handleTodosClick = useCallback(async () => {
    if (!selectedProject) return;
    selectTodos(selectedProject);
    setIsSessionDropdownOpen(false);
    try {
      const result = await api.getTodos(selectedProject);
      setTodos(result);
    } catch (error) {
      console.error('Failed to load todos:', error);
    }
  }, [selectedProject, selectTodos, setTodos]);

  const handleDeleteSession = useCallback((e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    onDeleteSession?.(session);
  }, [onDeleteSession]);

  // Get display name for project (basename)
  const getProjectDisplayName = (project: string) => {
    return project.split('/').pop() || project;
  };

  return (
    <header
      data-testid="header"
      className={`
        bg-white dark:bg-gray-800
        border-b border-gray-200 dark:border-gray-700
        shadow-sm
        ${className}
      `.trim()}
    >
      <div className="h-14 px-4 flex items-center justify-between">
        {/* Logo and Title */}
        <div className="flex items-center gap-3" data-testid="header-logo">
          <img
            src="/logo.png"
            alt="Mermaid Collab Logo"
            className="w-8 h-8"
          />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            Mermaid Collab
          </h1>

          {/* Connection Status Badge */}
          <div
            data-testid="connection-badge"
            className={`
              flex items-center gap-1.5
              px-2 py-1
              text-xs font-medium
              rounded-full
              ${
                isConnected
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                  : isConnecting
                  ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
                  : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
              }
            `}
          >
            <span
              className={`
                w-2 h-2 rounded-full
                ${
                  isConnected
                    ? 'bg-green-500'
                    : isConnecting
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-red-500'
                }
              `}
            />
            <span>
              {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
            </span>
          </div>

          <SessionStatusPanel variant="inline" />
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-3">
          {/* Refresh Button */}
          {onRefreshSessions && (
            <button
              data-testid="refresh-sessions"
              onClick={handleRefreshSessions}
              aria-label="Refresh"
              title="Refresh projects and sessions"
              className="
                p-2
                text-gray-600 dark:text-gray-300
                hover:text-gray-900 dark:hover:text-white
                hover:bg-gray-100 dark:hover:bg-gray-700
                rounded-lg
                transition-colors
              "
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
              </svg>
            </button>
          )}

          {/* Project Selector */}
          <div className="relative" ref={projectDropdownRef}>
            <button
              data-testid="project-selector"
              onClick={() => setIsProjectDropdownOpen((prev) => !prev)}
              aria-expanded={isProjectDropdownOpen}
              aria-haspopup="listbox"
              className="
                flex items-center gap-2
                px-3 py-1.5
                text-sm font-medium
                text-gray-700 dark:text-gray-200
                bg-gray-100 dark:bg-gray-700
                hover:bg-gray-200 dark:hover:bg-gray-600
                rounded-lg
                transition-colors
                min-w-[200px]
              "
            >
              <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="flex-1 text-left truncate">
                {selectedProject ? getProjectDisplayName(selectedProject) : 'Select Project'}
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${isProjectDropdownOpen ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {isProjectDropdownOpen && (
              <div
                data-testid="project-dropdown"
                role="listbox"
                className="
                  absolute left-0 mt-2 w-80
                  bg-white dark:bg-gray-800
                  border border-gray-200 dark:border-gray-700
                  rounded-lg shadow-lg
                  z-50 overflow-hidden
                  animate-fadeIn
                "
              >
                <ul className="max-h-60 overflow-y-auto">
                  {projects.map((project) => (
                    <li key={project}>
                      <button
                        role="option"
                        aria-selected={selectedProject === project}
                        onClick={() => handleProjectSelect(project)}
                        className={`
                          w-full px-4 py-2.5
                          text-left text-sm
                          hover:bg-gray-100 dark:hover:bg-gray-700
                          transition-colors
                          ${selectedProject === project ? 'bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300' : 'text-gray-700 dark:text-gray-200'}
                        `}
                      >
                        <div className="font-medium truncate">{getProjectDisplayName(project)}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{project}</div>
                      </button>
                    </li>
                  ))}
                </ul>
                {onAddProject && (
                  <div className="border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={handleAddProject}
                      className="
                        w-full px-4 py-2.5
                        text-left text-sm
                        text-blue-600 dark:text-blue-400
                        hover:bg-gray-100 dark:hover:bg-gray-700
                        transition-colors
                        flex items-center gap-2
                      "
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                      Add Project
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Session Selector */}
          <div className="relative" ref={sessionDropdownRef}>
            <button
              data-testid="session-selector"
              onClick={() => setIsSessionDropdownOpen((prev) => !prev)}
              aria-expanded={isSessionDropdownOpen}
              aria-haspopup="listbox"
              disabled={!selectedProject}
              className={`
                flex items-center gap-2
                px-3 py-1.5
                text-sm font-medium
                rounded-lg
                transition-colors
                min-w-[200px]
                ${!selectedProject
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  : 'text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                }
              `}
            >
              <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
              </svg>
              <span className="flex-1 text-left truncate">
                {todosSelected ? 'Todos' : currentSession?.project === selectedProject ? currentSession.name : 'Select Session'}
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${isSessionDropdownOpen ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {isSessionDropdownOpen && selectedProject && (
              <div
                data-testid="session-dropdown"
                role="listbox"
                className="
                  absolute left-0 mt-2 w-80
                  bg-white dark:bg-gray-800
                  border border-gray-200 dark:border-gray-700
                  rounded-lg shadow-lg
                  z-50 overflow-hidden
                  animate-fadeIn
                "
              >
                {/* Permanent Todos entry */}
                <div className="border-b border-gray-200 dark:border-gray-700">
                  <button
                    onClick={handleTodosClick}
                    className={`
                      w-full px-4 py-2.5
                      text-left text-sm
                      hover:bg-gray-100 dark:hover:bg-gray-700
                      transition-colors
                      flex items-center gap-2
                      ${todosSelected ? 'bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300' : 'text-gray-700 dark:text-gray-200'}
                    `}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                    </svg>
                    <span className="flex-1 font-medium">Todos</span>
                    {todos.length > 0 && (
                      <span className="
                        inline-flex items-center justify-center
                        px-1.5 py-0.5
                        text-xs font-medium
                        bg-blue-100 dark:bg-blue-900/40
                        text-blue-700 dark:text-blue-300
                        rounded-full
                      ">
                        {todos.length}
                      </span>
                    )}
                  </button>
                </div>

                {projectSessions.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    No sessions in this project
                  </div>
                ) : (
                  <ul className="max-h-60 overflow-y-auto">
                    {projectSessions.map((session) => (
                      <li key={session.name}>
                        <div
                          className={`
                            flex items-center
                            hover:bg-gray-100 dark:hover:bg-gray-700
                            transition-colors
                            ${currentSession?.name === session.name && currentSession?.project === session.project ? 'bg-accent-50 dark:bg-accent-900/30' : ''}
                          `}
                        >
                          <button
                            role="option"
                            aria-selected={currentSession?.name === session.name}
                            onClick={() => handleSessionClick(session)}
                            className={`
                              flex-1 px-4 py-2.5
                              text-left text-sm
                              ${currentSession?.name === session.name && currentSession?.project === session.project ? 'text-accent-700 dark:text-accent-300' : 'text-gray-700 dark:text-gray-200'}
                            `}
                          >
                            <div className="font-medium truncate">{session.name}</div>
                            {session.displayName && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                Status: {session.displayName}
                              </div>
                            )}
                          </button>
                          {onDeleteSession && (
                            <button
                              onClick={(e) => handleDeleteSession(e, session)}
                              className="
                                p-2 mr-2
                                text-gray-400 hover:text-red-500
                                dark:text-gray-500 dark:hover:text-red-400
                                transition-colors
                              "
                              aria-label={`Delete session ${session.name}`}
                              title="Delete session"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {onCreateSession && (
                  <div className="border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={handleCreateSession}
                      className="
                        w-full px-4 py-2.5
                        text-left text-sm
                        text-blue-600 dark:text-blue-400
                        hover:bg-gray-100 dark:hover:bg-gray-700
                        transition-colors
                        flex items-center gap-2
                      "
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                      New Session
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chat Panel Toggle */}
          <button
            data-testid="chat-panel-toggle"
            onClick={handleChatToggle}
            aria-label={chatPanelVisible ? 'Hide Chat' : 'Show Chat'}
            aria-pressed={chatPanelVisible}
            title={chatPanelVisible ? 'Hide Chat' : 'Show Chat'}
            className={`
              flex items-center gap-2
              px-3 py-1.5
              text-sm font-medium
              rounded-lg
              transition-colors
              ${
                chatPanelVisible
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }
            `}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>Chat</span>
          </button>

          {/* Terminal Panel Toggle */}
          <button
            data-testid="terminal-panel-toggle"
            onClick={handleTerminalToggle}
            aria-label={terminalPanelVisible ? 'Hide Terminal' : 'Show Terminal'}
            aria-pressed={terminalPanelVisible}
            title={terminalPanelVisible ? 'Hide Terminal' : 'Show Terminal'}
            className={`
              flex items-center gap-2
              px-3 py-1.5
              text-sm font-medium
              rounded-lg
              transition-colors
              ${
                terminalPanelVisible
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }
            `}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            <span>Terminal</span>
          </button>

          {/* Edit Mode Toggle */}
          <button
            data-testid="edit-mode-toggle"
            onClick={handleEditModeToggle}
            aria-label={editMode ? 'Hide Edit Panel' : 'Show Edit Panel'}
            aria-pressed={editMode}
            title={editMode ? 'Hide Edit Panel' : 'Show Edit Panel'}
            className={`
              flex items-center gap-2
              px-3 py-1.5
              text-sm font-medium
              rounded-lg
              transition-colors
              ${
                editMode
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }
            `}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            <span>Edit</span>
          </button>

          {/* Theme Toggle */}
          <button
            data-testid="theme-toggle"
            onClick={handleThemeToggle}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            className="
              p-2
              text-gray-600 dark:text-gray-300
              hover:text-gray-900 dark:hover:text-white
              hover:bg-gray-100 dark:hover:bg-gray-700
              rounded-lg
              transition-colors
            "
          >
            {theme === 'light' ? (
              <svg
                className="w-5 h-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            ) : (
              <svg
                className="w-5 h-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
