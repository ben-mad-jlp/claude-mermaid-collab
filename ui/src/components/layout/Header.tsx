/**
 * Header Component
 *
 * Top navigation bar with:
 * - Logo and application title
 * - Theme toggle (light/dark mode)
 * - Session selector dropdown
 *
 * Integrates with useTheme and useSession hooks for state management.
 */

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '@/hooks/useSession';
import { useUIStore } from '@/stores/uiStore';
import { Session } from '@/types';

export interface HeaderProps {
  /** Available sessions to select from */
  sessions?: Session[];
  /** Callback when a session is selected */
  onSessionSelect?: (session: Session) => void;
  /** Callback to refresh sessions list */
  onRefreshSessions?: () => void;
  /** Callback to create a new session */
  onCreateSession?: () => void;
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
 * Header component with logo, theme toggle, and session selector
 */
export const Header: React.FC<HeaderProps> = ({
  sessions = [],
  onSessionSelect,
  onRefreshSessions,
  onCreateSession,
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleToggleDropdown = useCallback(() => {
    setIsDropdownOpen((prev) => !prev);
  }, []);

  const handleSessionClick = useCallback(
    (session: Session) => {
      onSessionSelect?.(session);
      setIsDropdownOpen(false);
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

  const handleCreateSession = useCallback(() => {
    onCreateSession?.();
  }, [onCreateSession]);

  const handleDeleteSession = useCallback((e: React.MouseEvent, session: Session) => {
    e.stopPropagation(); // Prevent selecting the session
    if (window.confirm(`Delete session "${session.name}"? This removes it from the list but does not delete files.`)) {
      onDeleteSession?.(session);
    }
  }, [onDeleteSession]);

  // Format session display as "project / session"
  const formatSessionDisplay = (session: Session) => {
    const projectName = session.project?.split('/').pop() || 'unknown';
    return `${projectName} / ${session.name}`;
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
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-3">
          {/* Create Session Button */}
          {onCreateSession && (
            <button
              data-testid="create-session"
              onClick={handleCreateSession}
              aria-label="Create new session"
              title="Create new session"
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
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}

          {/* Refresh Sessions Button */}
          {onRefreshSessions && (
            <button
              data-testid="refresh-sessions"
              onClick={handleRefreshSessions}
              aria-label="Refresh sessions"
              title="Refresh sessions"
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

          {/* Session Selector */}
          {sessions.length > 0 && (
            <div className="relative" ref={dropdownRef}>
              <button
                data-testid="session-selector"
                onClick={handleToggleDropdown}
                aria-expanded={isDropdownOpen}
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
                "
              >
                <span className="max-w-96 truncate">
                  {currentSession ? formatSessionDisplay(currentSession) : 'Select Session'}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div
                  data-testid="session-dropdown"
                  role="listbox"
                  className="
                    absolute right-0 mt-2 w-[640px]
                    bg-white dark:bg-gray-800
                    border border-gray-200 dark:border-gray-700
                    rounded-lg shadow-lg
                    z-50 overflow-hidden
                    animate-fadeIn
                  "
                >
                  {sessions.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      No sessions available
                    </div>
                  ) : (
                    <ul className="max-h-60 overflow-y-auto">
                      {sessions.map((session) => (
                        <li key={`${session.project}-${session.name}`}>
                          <div
                            className={`
                              flex items-center
                              hover:bg-gray-100 dark:hover:bg-gray-700
                              transition-colors
                              ${
                                currentSession?.name === session.name
                                  ? 'bg-accent-50 dark:bg-accent-900/30'
                                  : ''
                              }
                            `}
                          >
                            <button
                              role="option"
                              aria-selected={currentSession?.name === session.name}
                              onClick={() => handleSessionClick(session)}
                              className={`
                                flex-1 px-4 py-2.5
                                text-left text-sm
                                ${
                                  currentSession?.name === session.name
                                    ? 'text-accent-700 dark:text-accent-300'
                                    : 'text-gray-700 dark:text-gray-200'
                                }
                              `}
                            >
                              <div className="font-medium truncate">{formatSessionDisplay(session)}</div>
                              {session.phase && (
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                  Phase: {session.phase}
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
                </div>
              )}
            </div>
          )}

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
