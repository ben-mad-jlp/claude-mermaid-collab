import React from 'react';
import type { TerminalConfig } from '../types/terminal';
import { XTermTerminal } from './terminal/XTermTerminal';

export interface EmbeddedTerminalProps {
  config: TerminalConfig;
  /** Unique tmux session name for persistence across refreshes */
  sessionName?: string;
  className?: string;
}

/**
 * EmbeddedTerminal - Renders a native xterm.js terminal
 *
 * Features:
 * - Text selection without auto-copy
 * - Right-click copies selected text to clipboard
 * - Connects to tmux sessions via WebSocket + Bun.Terminal
 * - Responsive sizing
 */
export const EmbeddedTerminal = React.memo(function EmbeddedTerminal({
  config,
  sessionName,
  className = '',
}: EmbeddedTerminalProps) {
  // Build WebSocket URL from config
  // The wsUrl should point to /terminal endpoint
  const wsUrl = config.wsUrl;

  // Use provided session name or 'default'
  const tmuxSession = sessionName || 'default';

  return (
    <div
      className={`embedded-terminal ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <XTermTerminal
        wsUrl={wsUrl}
        tmuxSession={tmuxSession}
        className="flex-1"
      />
    </div>
  );
});

EmbeddedTerminal.displayName = 'EmbeddedTerminal';
