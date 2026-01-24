import React, { useEffect } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import type { TerminalConfig } from '../types/terminal';

export interface EmbeddedTerminalProps {
  config: TerminalConfig;
  className?: string;
}

export function EmbeddedTerminal({ config, className = '' }: EmbeddedTerminalProps) {
  const { terminalRef, isConnected, error, reconnect } = useTerminal(config);

  useEffect(() => {
    if (terminalRef.current && typeof (terminalRef.current as any).open === 'function') {
      const container = document.getElementById('terminal-container');
      if (container && !container.hasChildNodes()) {
        (terminalRef.current as any).open(container);
      }
    }
  }, [terminalRef]);

  return (
    <div className={`embedded-terminal ${className}`}>
      {error && (
        <div className="terminal-error">
          <p>{error}</p>
          <button onClick={reconnect} className="reconnect-btn">
            Reconnect
          </button>
        </div>
      )}
      {!error && (
        <div className="terminal-status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'connecting'}`} />
          {isConnected ? 'Connected' : 'Connecting...'}
        </div>
      )}
      <div
        id="terminal-container"
        data-testid="terminal-container"
        className="terminal-container"
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      />
    </div>
  );
}
