import React from 'react';
import type { TerminalConfig } from '../types/terminal';

export interface EmbeddedTerminalProps {
  config: TerminalConfig;
  /** Unique tmux session name for persistence across refreshes */
  sessionName?: string;
  className?: string;
}

/**
 * EmbeddedTerminal - Renders a ttyd terminal iframe
 *
 * Terminals auto-start immediately on render (no "Start Terminal" button).
 * This prevents state reset issues when React remounts the component.
 */
export const EmbeddedTerminal = React.memo(function EmbeddedTerminal({ config, sessionName, className = '' }: EmbeddedTerminalProps) {
  // Build iframe URL from WebSocket URL
  // ws://localhost:7681/ws -> http://localhost:7681
  let iframeUrl = config.wsUrl
    .replace('ws://', 'http://')
    .replace('wss://', 'https://')
    .replace('/ws', '');

  // Append session name for tmux session attachment
  // ttyd is started with: ttyd tmux new-session -A -s
  // The ?arg= parameter passes the session name to tmux
  // Always provide a session name (use 'default' as fallback)
  const tmuxSession = sessionName || 'default';
  iframeUrl += `?arg=${encodeURIComponent(tmuxSession)}`;

  return (
    <div
      className={`embedded-terminal ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%'
      }}
    >
      <iframe
        src={iframeUrl}
        style={{
          flex: 1,
          border: 'none',
          background: '#1e1e1e',
        }}
        title="Terminal"
      />
    </div>
  );
});

EmbeddedTerminal.displayName = 'EmbeddedTerminal';
