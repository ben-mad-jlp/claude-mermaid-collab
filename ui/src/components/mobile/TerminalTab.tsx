import React from 'react';
import { XTermTerminal } from '../terminal/XTermTerminal';

export interface TerminalConfig {
  sessionId: string;
  wsUrl: string;
}

export interface TerminalTabProps {
  /** Terminal configuration with sessionId and wsUrl */
  terminal: TerminalConfig | null;
  /** Whether a terminal session is currently active */
  hasSession: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Optional callback to create a new terminal session */
  onCreateTerminal?: () => void;
}

/**
 * TerminalTab - Full-screen terminal wrapper component
 *
 * Wraps the XTermTerminal component in a full-screen container that:
 * - Fills available height between header and tab bar
 * - Automatically handles resize via xterm addon-fit
 * - Shows a placeholder message when no terminal session is active
 *
 * The component manages the layout to ensure the terminal fills all available
 * space and properly handles the flex layout with minHeight: 0 for proper
 * height calculation in flex containers.
 */
export const TerminalTab: React.FC<TerminalTabProps> = ({
  terminal,
  hasSession,
  className = '',
  onCreateTerminal,
}) => {
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
      {hasSession && terminal ? (
        <XTermTerminal
          sessionId={terminal.sessionId}
          wsUrl={terminal.wsUrl}
          className="terminal-tab-content"
        />
      ) : (
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
          {onCreateTerminal && (
            <button
              onClick={onCreateTerminal}
              disabled={!onCreateTerminal}
              className="mt-4 px-4 py-2 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 dark:bg-accent-600 dark:hover:bg-accent-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="new-terminal-button"
            >
              New Terminal
            </button>
          )}
        </div>
      )}
    </div>
  );
};

TerminalTab.displayName = 'TerminalTab';
