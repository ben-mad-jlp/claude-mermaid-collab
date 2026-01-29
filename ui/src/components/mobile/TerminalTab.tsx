import React, { useEffect, useRef } from 'react';
import { XTermTerminal } from '../terminal/XTermTerminal';
import { MobileTerminalTabBar } from './MobileTerminalTabBar';
import type { TerminalSession } from '../../types/terminal';

export interface TerminalTabProps {
  /** Terminal tabs from useTerminalTabs hook */
  tabs: TerminalSession[];
  /** Currently active tab ID */
  activeTabId: string | null;
  /** Currently active tab object */
  activeTab: TerminalSession | null;
  /** Whether terminals are loading */
  isLoading: boolean;
  /** Error from terminal operations */
  error: Error | null;
  /** Callback when a tab is selected */
  onTabSelect: (id: string) => void;
  /** Callback when a tab is closed */
  onTabClose: (id: string) => void;
  /** Callback to add a new terminal tab */
  onTabAdd: () => void;
  /** Optional CSS class name */
  className?: string;
}

/**
 * TerminalTab - Full-screen terminal wrapper component with multi-tab support
 *
 * Wraps the XTermTerminal component in a full-screen container that:
 * - Shows a mobile-optimized tab bar when tabs exist
 * - Fills available height between header and tab bar
 * - Automatically handles resize via xterm addon-fit
 * - Shows a placeholder message when no terminal session is active
 * - Shows loading and error states
 */
export const TerminalTab: React.FC<TerminalTabProps> = ({
  tabs,
  activeTabId,
  activeTab,
  isLoading,
  error,
  onTabSelect,
  onTabClose,
  onTabAdd,
  className = '',
}) => {
  // Store refs to terminal wrapper elements for explicit resize triggering
  const terminalRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Trigger resize when active tab changes
  useEffect(() => {
    if (!activeTabId) return;

    const terminalWrapper = terminalRefs.current.get(activeTabId);
    if (!terminalWrapper) return;

    // Trigger resize event on the wrapper to notify ResizeObserver
    // Use double RAF to ensure DOM has settled after visibility change
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Dispatch a resize event which triggers the ResizeObserver
        const resizeEvent = new Event('resize', { bubbles: true });
        terminalWrapper.dispatchEvent(resizeEvent);
      });
    });
  }, [activeTabId]);
  // Loading state
  if (isLoading) {
    return (
      <div
        className={`terminal-tab ${className}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          width: '100%',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: '#999',
            fontSize: '1rem',
          }}
        >
          <p>Loading terminals...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={`terminal-tab ${className}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          width: '100%',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: '#d32f2f',
            fontSize: '1rem',
            padding: '20px',
            textAlign: 'center',
          }}
        >
          <p style={{ marginBottom: '10px', fontWeight: 'bold' }}>Error loading terminals</p>
          <p style={{ fontSize: '0.9em' }}>{error.message}</p>
          <button
            onClick={onTabAdd}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 dark:bg-accent-600 dark:hover:bg-accent-700 rounded-lg transition-colors"
            data-testid="retry-terminal-button"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // No tabs - show "New Terminal" button
  if (tabs.length === 0) {
    return (
      <div
        className={`terminal-tab ${className}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          width: '100%',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: '#999',
            fontSize: '1rem',
          }}
        >
          <p>No active terminal</p>
          <button
            onClick={onTabAdd}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 dark:bg-accent-600 dark:hover:bg-accent-700 rounded-lg transition-colors"
            data-testid="new-terminal-button"
          >
            New Terminal
          </button>
        </div>
      </div>
    );
  }

  // Has tabs - show tab bar and terminal
  return (
    <div
      className={`terminal-tab ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Tab bar */}
      <MobileTerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={onTabSelect}
        onTabClose={onTabClose}
        onTabAdd={onTabAdd}
      />

      {/* Terminal content area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {activeTab ? (
          // Render all terminals but only show active one (preserves state)
          tabs.map((tab) => (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) {
                  terminalRefs.current.set(tab.id, el);
                } else {
                  terminalRefs.current.delete(tab.id);
                }
              }}
              style={{
                display: tab.id === activeTabId ? 'flex' : 'none',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
              }}
            >
              <XTermTerminal
                sessionId={tab.id}
                wsUrl="/terminal"
                className="terminal-tab-content"
              />
            </div>
          ))
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
            }}
          >
            No terminal selected
          </div>
        )}
      </div>
    </div>
  );
};

TerminalTab.displayName = 'TerminalTab';
