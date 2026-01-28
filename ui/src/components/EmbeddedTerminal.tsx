import React from 'react';
import type { TerminalConfig } from '../types/terminal';
import { XTermTerminal } from './terminal/XTermTerminal';

export interface EmbeddedTerminalProps {
  config: TerminalConfig;
  /** Unique session ID for PTY session */
  sessionId?: string;
  className?: string;
}

/**
 * EmbeddedTerminal - Renders a native xterm.js terminal
 *
 * Features:
 * - Text selection without auto-copy
 * - Right-click copies selected text to clipboard
 * - Connects to PTY sessions via WebSocket + Bun native PTY
 * - Responsive sizing
 */
export const EmbeddedTerminal = React.memo(function EmbeddedTerminal({
  config,
  sessionId,
  className = '',
}: EmbeddedTerminalProps) {
  // Build WebSocket URL from config
  // The wsUrl should point to /terminal endpoint base
  const wsUrl = config.wsUrl;

  // Use provided session ID or 'default'
  const terminalSessionId = sessionId || 'default';

  return (
    <div
      className={`embedded-terminal ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      <XTermTerminal
        wsUrl={wsUrl}
        sessionId={terminalSessionId}
      />
    </div>
  );
});

EmbeddedTerminal.displayName = 'EmbeddedTerminal';
