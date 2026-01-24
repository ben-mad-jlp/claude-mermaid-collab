import React, { useState, useCallback } from 'react';
import type { TerminalConfig } from '../types/terminal';

export interface EmbeddedTerminalProps {
  config: TerminalConfig;
  className?: string;
}

export function EmbeddedTerminal({ config, className = '' }: EmbeddedTerminalProps) {
  const [isStarted, setIsStarted] = useState(false);

  // Extract host from wsUrl (ws://localhost:7682/ws -> http://localhost:7682)
  const iframeUrl = config.wsUrl
    .replace('ws://', 'http://')
    .replace('wss://', 'https://')
    .replace('/ws', '');

  const startTerminal = useCallback(() => {
    setIsStarted(true);
  }, []);

  return (
    <div className={`embedded-terminal ${className}`} style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {!isStarted && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#1e1e1e',
            zIndex: 10,
          }}
        >
          <button
            onClick={startTerminal}
            style={{
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: 500,
              color: '#fff',
              background: '#3b82f6',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Start Terminal
          </button>
          <p style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
            Click to open terminal session
          </p>
        </div>
      )}

      {isStarted && (
        <iframe
          src={iframeUrl}
          style={{
            flex: 1,
            border: 'none',
            background: '#1e1e1e',
          }}
          title="Terminal"
        />
      )}

      {!isStarted && (
        <div
          data-testid="terminal-container"
          style={{ flex: 1, minHeight: '200px', visibility: 'hidden' }}
        />
      )}
    </div>
  );
}
