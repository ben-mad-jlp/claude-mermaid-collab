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

import React, { useCallback, useState, useRef, useEffect } from 'react';
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
  const bridgeOpen = useUIStore((s) => s.bridgeOpen);
  const planOpen = useUIStore((s) => s.planOpen);

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

  // Project-management dropdown: list registered projects, add a new one, or
  // remove an existing one. Anchored to the project label.
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!projectMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [projectMenuOpen]);

  // Select a project: switch to its most-recent session if one exists, else
  // offer to create one. Keeps the dropdown a true project switcher.
  const handleSelectProject = useCallback(
    (project: string) => {
      setProjectMenuOpen(false);
      const projSessions = sessions.filter((s) => s.project === project);
      if (projSessions.length > 0) {
        onSessionSelect?.(projSessions[0]);
      } else {
        onCreateSession?.(project);
      }
    },
    [sessions, onSessionSelect, onCreateSession],
  );

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
          {/* Pane toggles — left, just right of the Collab label. Bridge / Plan /
              Studio dock side-by-side; Browser / Terminal dock on the right. */}
          <div className="flex items-center gap-1.5">
            <button
              data-testid="toggle-bridge"
              onClick={() => useUIStore.getState().toggleBridge()}
              aria-label="Toggle Bridge pane"
              title="Bridge"
              className={paneToggleClass(bridgeOpen)}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
            </button>
            <button
              data-testid="toggle-plan"
              onClick={() => useUIStore.getState().togglePlan()}
              aria-label="Toggle Plan pane"
              title="Plan"
              className={paneToggleClass(planOpen)}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="2.5" />
                <circle cx="6" cy="18" r="2.5" />
                <circle cx="18" cy="12" r="2.5" />
                <path d="M8.5 6H13a2 2 0 0 1 2 2v2M8.5 18H13a2 2 0 0 0 2-2v-2" />
              </svg>
            </button>
            <button
              data-testid="toggle-viewer"
              onClick={() => useUIStore.getState().toggleViewer()}
              aria-label="Toggle Studio (artifact viewer)"
              title="Studio"
              className={paneToggleClass(viewerVisible)}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="9" x2="9" y2="20" />
              </svg>
            </button>
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
          </div>

          {/* VS Code Connection Badge */}
          <div
            data-testid="vscode-badge"
            className={`
              flex items-center gap-1.5
              px-2 py-1
              text-xs font-medium
              rounded-full
              ${isVscodeConnected
                ? 'bg-success-300 text-black'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}
            `}
          >
            <span className={`w-2 h-2 rounded-full ${isVscodeConnected ? 'bg-success-500' : 'bg-gray-400'}`} />
            <span>VSCode {isVscodeConnected ? 'Connected' : 'Disconnected'}</span>
          </div>

          {/* Live (WebSocket) connection badge — surfaces socket drops so the
              user has a signal when the Bridge briefly goes stale on reconnect
              (BUG: post-reconnect resync gap). */}
          <div
            data-testid="ws-badge"
            title={
              isConnected
                ? 'Live updates connected'
                : isConnecting
                ? 'Reconnecting to live updates…'
                : 'Live updates disconnected'
            }
            className={`
              flex items-center gap-1.5
              px-2 py-1
              text-xs font-medium
              rounded-full
              ${isConnected
                ? 'bg-success-300 text-black'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}
            `}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-success-500' : isConnecting ? 'bg-warning-500 animate-pulse' : 'bg-gray-400'
              }`}
            />
            <span>{isConnected ? 'Live' : isConnecting ? 'Reconnecting…' : 'Offline'}</span>
          </div>

        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-3">
          {/* Project + Session Labels (project is a management dropdown) */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-gray-100 dark:bg-gray-700 rounded-lg min-w-[200px]"
          >
            <div className="relative" ref={projectMenuRef}>
              <button
                type="button"
                data-testid="header-project-label"
                title={currentSession?.project ?? 'Manage projects'}
                onClick={() => setProjectMenuOpen((o) => !o)}
                className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300 truncate max-w-[200px] hover:text-gray-900 dark:hover:text-white"
              >
                <span className="truncate">
                  {currentSession?.project ? getProjectDisplayName(currentSession.project) : '—'}
                </span>
                <svg className={`w-3 h-3 shrink-0 transition-transform ${projectMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>

              {projectMenuOpen && (
                <div
                  data-testid="project-menu"
                  className="absolute left-0 top-full mt-1 z-50 w-72 max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
                >
                  <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    Projects
                  </div>
                  {registeredProjects.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No projects yet</div>
                  ) : (
                    registeredProjects.map((project) => {
                      const isCurrent = currentSession?.project === project;
                      return (
                        <div
                          key={project}
                          className={`group flex items-center gap-1 px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                            isCurrent ? 'bg-gray-50 dark:bg-gray-700/50' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectProject(project)}
                            title={project}
                            className="flex-1 min-w-0 text-left truncate text-gray-800 dark:text-gray-200"
                          >
                            {isCurrent && <span className="text-accent-500 mr-1">•</span>}
                            {getProjectDisplayName(project)}
                          </button>
                          {onRemoveProject && (
                            <button
                              type="button"
                              data-testid="project-remove"
                              title={`Remove ${getProjectDisplayName(project)}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Remove project "${getProjectDisplayName(project)}"?\n\nThis unregisters it from the UI; files on disk are untouched.`)) {
                                  onRemoveProject(project);
                                }
                              }}
                              className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-gray-400 hover:text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30 transition-opacity"
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                  {onAddProject && (
                    <>
                      <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                      <button
                        type="button"
                        data-testid="project-add"
                        onClick={() => {
                          setProjectMenuOpen(false);
                          onAddProject();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-accent-600 dark:text-accent-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                        Add project…
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
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
