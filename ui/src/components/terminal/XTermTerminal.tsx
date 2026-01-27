import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { AttachAddon } from '@xterm/addon-attach';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface XTermTerminalProps {
  wsUrl: string;
  className?: string;
}

/**
 * XTermTerminal - Renders an xterm.js terminal connected to ttyd backend
 *
 * Features:
 * - Text selection without auto-copy
 * - Right-click copies selected text to clipboard
 * - Connects to tmux sessions via ttyd WebSocket backend
 * - Responsive sizing with FitAddon
 */
export const XTermTerminal = React.memo(function XTermTerminal({
  wsUrl,
  className = '',
}: XTermTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance with rightClickSelectsWord disabled
    const term = new Terminal({
      rightClickSelectsWord: false,
      cols: 80,
      rows: 24,
      cursorBlink: true,
      cursorStyle: 'block',
    });

    terminalInstanceRef.current = term;

    // Create WebSocket connection to ttyd backend
    const wsProtocol = wsUrl.startsWith('wss://') ? 'wss://' : 'ws://';
    const wsUrl2 = wsUrl.replace('ws://', wsProtocol).replace('wss://', wsProtocol);
    const ws = new WebSocket(wsUrl2);
    wsRef.current = ws;

    // Create and attach addons
    const attachAddon = new AttachAddon(ws);
    const fitAddon = new FitAddon();

    term.loadAddon(attachAddon);
    term.loadAddon(fitAddon);

    // Open terminal in DOM
    term.open(terminalRef.current);

    // Fit terminal to container
    try {
      fitAddon.fit();
    } catch (e) {
      // Silently ignore fit errors if terminal not ready
    }

    // Handle context menu for copying selected text
    term.onContextMenu(async (event: MouseEvent) => {
      const selection = term.getSelection();

      if (selection && selection.trim()) {
        try {
          await navigator.clipboard.writeText(selection);
        } catch (err) {
          // Silently ignore clipboard errors
          console.error('Failed to copy to clipboard:', err);
        }
      }
    });

    // Handle window resize to fit terminal
    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch (e) {
        // Silently ignore fit errors
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      ws.close();
    };
  }, [wsUrl]);

  return (
    <div
      ref={terminalRef}
      data-testid="xterm-container"
      className={className}
      style={{
        height: '100%',
        width: '100%',
      }}
    />
  );
});

XTermTerminal.displayName = 'XTermTerminal';
