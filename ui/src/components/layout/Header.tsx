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

import React, { useCallback } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '@/hooks/useSession';
import { NavMenu } from './NavMenu';
import { useTerminalStore } from '@/stores/terminalStore';
import { useBrowserStore } from '@/stores/browserStore';
import { useUIStore } from '@/stores/uiStore';
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
  /** Callback to remove a project */
  onRemoveProject?: (project: string) => void;
  /** Callback to delete a session */
  onDeleteSession?: (session: Session) => void;
  /** WebSocket connection status */
  isConnected?: boolean;
  /** Whether WebSocket is connecting */
  isConnecting?: boolean;
  /** Whether VS Code extension is connected */
  isVscodeConnected?: boolean;
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
  onRemoveProject,
  onDeleteSession,
  isConnected = false,
  isConnecting = false,
  isVscodeConnected = false,
  className = '',
}) => {
  const { theme, toggleTheme } = useTheme();
  const { currentSession } = useSession();
  const zoomLevel = useUIStore((s) => s.zoomLevel);
  const zoomIn = useUIStore((s) => s.zoomIn);
  const zoomOut = useUIStore((s) => s.zoomOut);

  // Reactive pane-visibility for highlighting the toggle buttons.
  const terminalOpen = useTerminalStore((s) => s.open);
  const browserVisible = useBrowserStore((s) => s.visible);
  const viewerVisible = useUIStore((s) => s.viewerVisible);

  // Shared style for a pane-toggle button; highlighted (accent) when its pane
  // is showing, neutral otherwise.
  const paneToggleClass = (active: boolean) =>
    `p-2 rounded-lg transition-colors ${
      active
        ? 'bg-accent-100 dark:bg-accent-900/50 text-accent-700 dark:text-accent-300'
        : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
    }`;

  const handleThemeToggle = useCallback(() => {
    toggleTheme();
  }, [toggleTheme]);


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
          <NavMenu />
          <h1 className="text-sm font-semibold text-gray-900 dark:text-white">
            Collab
          </h1>

          {/* VS Code Connection Badge */}
          <div
            data-testid="vscode-badge"
            className={`
              flex items-center gap-1.5
              px-2 py-1
              text-xs font-medium
              rounded-full
              ${isVscodeConnected
                ? 'bg-green-300 text-black'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}
            `}
          >
            <span className={`w-2 h-2 rounded-full ${isVscodeConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span>VSCode {isVscodeConnected ? 'Connected' : 'Disconnected'}</span>
          </div>

        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-3">
          {/* Artifact viewer toggle */}
          <button
            data-testid="toggle-viewer"
            onClick={() => useUIStore.getState().toggleViewer()}
            aria-label="Toggle artifact viewer"
            title="Toggle artifact viewer"
            className={paneToggleClass(viewerVisible)}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="9" x2="9" y2="20" />
            </svg>
          </button>

          {/* Browser toggle */}
          <button
            data-testid="toggle-browser"
            onClick={() => useBrowserStore.getState().toggle()}
            aria-label="Toggle browser"
            title="Browser"
            className={paneToggleClass(browserVisible)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="9"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>
            </svg>
          </button>

          {/* Terminal toggle */}
          <button
            data-testid="toggle-terminal"
            onClick={() => useTerminalStore.getState().toggle()}
            aria-label="Toggle terminal"
            title="Toggle terminal"
            className={paneToggleClass(terminalOpen)}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>

          {/* Project + Session Labels */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-gray-100 dark:bg-gray-700 rounded-lg min-w-[200px]"
          >
            <span
              data-testid="header-project-label"
              title={currentSession?.project ?? ''}
              className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[200px]"
            >
              {currentSession?.project ? getProjectDisplayName(currentSession.project) : '—'}
            </span>
            <span className="text-gray-400">/</span>
            <span
              data-testid="header-session-label"
              className="text-sm text-gray-900 dark:text-gray-100 truncate max-w-[200px]"
            >
              {currentSession?.name ?? '—'}
            </span>
          </div>

          {/* Text Size Control */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={zoomOut}
              title="Decrease text size"
              className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              −
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums min-w-[3ch] text-center">
              {zoomLevel}%
            </span>
            <button
              onClick={zoomIn}
              title="Increase text size"
              className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              +
            </button>
          </div>

          {/* Theme Toggle */}
          <button
            data-testid="theme-toggle"
            onClick={handleThemeToggle}
            aria-label={
              theme === 'light' ? 'Light mode (click for dark)' :
              theme === 'dark' ? 'Dark mode (click for sepia)' :
              'Sepia mode (click for light)'
            }
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
              // Sun — current theme is light
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
              </svg>
            ) : theme === 'dark' ? (
              // Moon — current theme is dark
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            ) : (
              // Book — current theme is sepia
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
