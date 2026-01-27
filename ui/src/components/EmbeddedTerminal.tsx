import React from 'react';
import { XTermTerminal } from './terminal/XTermTerminal';
import type { TerminalConfig } from '../types/terminal';

export interface EmbeddedTerminalProps {
  config: TerminalConfig;
  /** Unique tmux session name (kept for backward compatibility, no longer used) */
  sessionName?: string;
  className?: string;
}

/**
 * EmbeddedTerminal - Renders an xterm.js terminal connected to ttyd backend
 *
 * Replaced iframe-based terminal with direct xterm.js component for:
 * - Full control over text selection behavior
 * - Right-click support for copying selected text
 * - Better integration with tmux sessions via WebSocket
 */
export const EmbeddedTerminal = React.memo(function EmbeddedTerminal({ config, sessionName, className = '' }: EmbeddedTerminalProps) {
  return (
    <div
      className={`embedded-terminal ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%'
      }}
    >
      <XTermTerminal
        wsUrl={config.wsUrl}
        className={className}
      />
    </div>
  );
});

EmbeddedTerminal.displayName = 'EmbeddedTerminal';
