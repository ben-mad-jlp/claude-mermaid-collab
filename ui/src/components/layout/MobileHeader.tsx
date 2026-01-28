/**
 * MobileHeader Component
 *
 * Compact mobile header with:
 * - Small logo on left
 * - Project dropdown
 * - Session dropdown
 * - Refresh button
 * - Theme toggle
 * - Connection status badge
 *
 * Uses icon-only buttons and smaller dropdowns for mobile viewports.
 */

import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '@/hooks/useSession';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { Session } from '@/types';

/**
 * Get phase badge color classes based on state or displayName
 */
function getPhaseColor(state: string | undefined, displayName: string | undefined): string {
  if (state) {
    if (state.startsWith('brainstorm')) {
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    }
    if (state.startsWith('rough-draft') || state === 'build-task-graph') {
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
    }
    if (state === 'execute-batch' || state === 'ready-to-implement') {
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    }
    if (state === 'systematic-debugging') {
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    }
    if (state.startsWith('clear-') || state.endsWith('-router')) {
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
    }
    if (state === 'done' || state === 'workflow-complete' || state === 'cleanup') {
      return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
    }
  }

  if (displayName) {
    const lower = displayName.toLowerCase();
    if (lower.includes('exploring') || lower.includes('clarifying') || lower.includes('designing') || lower.includes('validating')) {
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    }
    if (lower.includes('interface') || lower.includes('pseudocode') || lower.includes('skeleton') || lower.includes('task')) {
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
    }
    if (lower.includes('executing') || lower.includes('ready')) {
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
    }
    if (lower.includes('investigating')) {
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    }
  }

  return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
}

export interface MobileHeaderProps {
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
 * Compact mobile header with icon-only buttons and dropdown controls
 */
export const MobileHeader: React.FC<MobileHeaderProps> = ({
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
  const collabState = useSessionStore((state) => state.collabState);

  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isSessionDropdownOpen, setIsSessionDropdownOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const sessionDropdownRef = useRef<HTMLDivElement>(null);

  // Get unique projects from sessions and registered projects
  const projects = useMemo(() => {
    const projectSet = new Set<string>();
    sessions.forEach((s) => {
      if (s.project) projectSet.add(s.project);
    });
    registeredProjects.forEach((p) => projectSet.add(p));
    return Array.from(projectSet).sort();
  }, [sessions, registeredProjects]);

  // Get sessions for selected project
  const projectSessions = useMemo(() => {
    if (!selectedProject) return [];
    return sessions.filter((s) => s.project === selectedProject);
  }, [sessions, selectedProject]);

  // Sync selectedProject with currentSession
  useEffect(() => {
    if (currentSession?.project) {
      setSelectedProject(currentSession.project);
    }
  }, [currentSession?.project]);

  // Auto-select first project if none selected
  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      if (currentSession?.project) {
        setSelectedProject(currentSession.project);
      } else {
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

  const handleProjectSelect = useCallback(
    (project: string) => {
      setSelectedProject(project);
      setIsProjectDropdownOpen(false);
      const sessionsInProject = sessions.filter((s) => s.project === project);
      if (sessionsInProject.length > 0 && onSessionSelect) {
        onSessionSelect(sessionsInProject[0]);
      } else if (currentSession && currentSession.project !== project) {
        onSessionSelect?.(null as unknown as Session);
      }
    },
    [sessions, onSessionSelect, currentSession]
  );

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

  const handleDeleteSession = useCallback(
    (e: React.MouseEvent, session: Session) => {
      e.stopPropagation();
      if (window.confirm(`Delete session "${session.name}"? This removes it from the list but does not delete files.`)) {
        onDeleteSession?.(session);
      }
    },
    [onDeleteSession]
  );

  // Get display name for project (basename)
  const getProjectDisplayName = (project: string) => {
    return project.split('/').pop() || project;
  };

  return (
    <header
      data-testid="mobile-header"
      className={`
        bg-white dark:bg-gray-800
        border-b border-gray-200 dark:border-gray-700
        shadow-sm
        h-12 px-2 flex items-center justify-between gap-1
        ${className}
      `.trim()}
    >
      {/* Logo */}
      <div className="flex items-center flex-shrink-0" data-testid="mobile-header-logo">
        <img
          src="/logo.png"
          alt="Mermaid Collab Logo"
          className="w-6 h-6"
        />
      </div>

      {/* Center/Right Controls */}
      <div className="flex items-center gap-1 flex-grow">
        {/* Project Selector - Icon Only */}
        <div className="relative" ref={projectDropdownRef}>
          <button
            data-testid="mobile-project-selector"
            onClick={() => setIsProjectDropdownOpen((prev) => !prev)}
            aria-expanded={isProjectDropdownOpen}
            aria-haspopup="listbox"
            title={selectedProject ? getProjectDisplayName(selectedProject) : 'Select Project'}
            className="
              p-1.5
              text-gray-600 dark:text-gray-300
              hover:text-gray-900 dark:hover:text-white
              hover:bg-gray-100 dark:hover:bg-gray-700
              rounded-lg
              transition-colors
              flex-shrink-0
            "
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>

          {isProjectDropdownOpen && (
            <div
              data-testid="mobile-project-dropdown"
              role="listbox"
              className="
                absolute left-0 mt-1 w-48
                bg-white dark:bg-gray-800
                border border-gray-200 dark:border-gray-700
                rounded-lg shadow-lg
                z-50 overflow-hidden
                animate-fadeIn
              "
            >
              <ul className="max-h-48 overflow-y-auto">
                {projects.map((project) => (
                  <li key={project}>
                    <button
                      role="option"
                      aria-selected={selectedProject === project}
                      onClick={() => handleProjectSelect(project)}
                      className={`
                        w-full px-3 py-2
                        text-left text-xs
                        hover:bg-gray-100 dark:hover:bg-gray-700
                        transition-colors
                        truncate
                        ${selectedProject === project ? 'bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300' : 'text-gray-700 dark:text-gray-200'}
                      `}
                    >
                      {getProjectDisplayName(project)}
                    </button>
                  </li>
                ))}
              </ul>
              {onAddProject && (
                <div className="border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={handleAddProject}
                    className="
                      w-full px-3 py-2
                      text-left text-xs
                      text-blue-600 dark:text-blue-400
                      hover:bg-gray-100 dark:hover:bg-gray-700
                      transition-colors
                      flex items-center gap-2
                    "
                  >
                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    Add Project
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Session Selector - Icon Only */}
        <div className="relative" ref={sessionDropdownRef}>
          <button
            data-testid="mobile-session-selector"
            onClick={() => {
              if (selectedProject) {
                setIsSessionDropdownOpen((prev) => !prev);
              }
            }}
            aria-expanded={isSessionDropdownOpen && !!selectedProject}
            aria-haspopup="listbox"
            disabled={!selectedProject}
            title={currentSession?.project === selectedProject ? currentSession.name : 'Select Session'}
            className={`
              p-1.5
              rounded-lg
              transition-colors
              flex-shrink-0
              ${
                !selectedProject
                  ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
              }
            `}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
            </svg>
          </button>

          {isSessionDropdownOpen && selectedProject && (
            <div
              data-testid="mobile-session-dropdown"
              role="listbox"
              className="
                absolute left-0 mt-1 w-48
                bg-white dark:bg-gray-800
                border border-gray-200 dark:border-gray-700
                rounded-lg shadow-lg
                z-50 overflow-hidden
                animate-fadeIn
              "
            >
              {projectSessions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                  No sessions
                </div>
              ) : (
                <ul className="max-h-48 overflow-y-auto">
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
                            flex-1 px-3 py-2
                            text-left text-xs
                            truncate
                            ${currentSession?.name === session.name && currentSession?.project === session.project ? 'text-accent-700 dark:text-accent-300' : 'text-gray-700 dark:text-gray-200'}
                          `}
                        >
                          {session.name}
                        </button>
                        {onDeleteSession && (
                          <button
                            onClick={(e) => handleDeleteSession(e, session)}
                            className="
                              p-1 mr-1 flex-shrink-0
                              text-gray-400 hover:text-red-500
                              dark:text-gray-500 dark:hover:text-red-400
                              transition-colors
                            "
                            aria-label={`Delete session ${session.name}`}
                            title="Delete session"
                          >
                            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
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
                      w-full px-3 py-2
                      text-left text-xs
                      text-blue-600 dark:text-blue-400
                      hover:bg-gray-100 dark:hover:bg-gray-700
                      transition-colors
                      flex items-center gap-2
                    "
                  >
                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    New Session
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Refresh Button */}
        {onRefreshSessions && (
          <button
            data-testid="mobile-refresh-sessions"
            onClick={handleRefreshSessions}
            aria-label="Refresh"
            title="Refresh projects and sessions"
            className="
              p-1.5
              text-gray-600 dark:text-gray-300
              hover:text-gray-900 dark:hover:text-white
              hover:bg-gray-100 dark:hover:bg-gray-700
              rounded-lg
              transition-colors
              flex-shrink-0
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

        {/* Theme Toggle */}
        <button
          data-testid="mobile-theme-toggle"
          onClick={handleThemeToggle}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          className="
            p-1.5
            text-gray-600 dark:text-gray-300
            hover:text-gray-900 dark:hover:text-white
            hover:bg-gray-100 dark:hover:bg-gray-700
            rounded-lg
            transition-colors
            flex-shrink-0
          "
        >
          {theme === 'light' ? (
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
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

        {/* Session Status Badge */}
        {collabState?.displayName && (
          <div
            data-testid="mobile-status-badge"
            className={`
              ml-auto px-1.5 py-0.5
              text-[10px] font-medium
              rounded
              truncate max-w-[100px]
              flex-shrink-0
              ${getPhaseColor(collabState.state, collabState.displayName)}
            `}
            title={collabState.displayName}
          >
            {collabState.displayName}
          </div>
        )}

        {/* Connection Status Dot */}
        <div
          data-testid="mobile-connection-badge"
          className={`flex-shrink-0 ${!collabState?.displayName ? 'ml-auto' : ''}`}
          title={isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
        >
          <span
            className={`
              block w-2 h-2 rounded-full
              ${
                isConnected
                  ? 'bg-green-500'
                  : isConnecting
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-red-500'
              }
            `}
          />
        </div>
      </div>
    </header>
  );
};

export default MobileHeader;
