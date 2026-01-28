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
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: '#999',
            fontSize: '1rem',
          }}
        >
          No active terminal
        </div>
      )}
    </div>
  );
};

TerminalTab.displayName = 'TerminalTab';
