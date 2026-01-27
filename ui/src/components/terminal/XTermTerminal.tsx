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
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isDisposedRef = useRef(false);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Reset disposed flag
    isDisposedRef.current = false;

    // Create terminal instance with rightClickSelectsWord disabled
    const term = new Terminal({
      rightClickSelectsWord: false,
      cols: 80,
      rows: 24,
      cursorBlink: true,
      cursorStyle: 'block',
    });

    terminalInstanceRef.current = term;

    // Create FitAddon early
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    // Open terminal in DOM first
    term.open(terminalRef.current);

    // Fit terminal to container after opening
    const safeFit = () => {
      if (isDisposedRef.current) return;
      try {
        fitAddon.fit();
      } catch (e) {
        // Silently ignore fit errors if terminal not ready
      }
    };

    // Initial fit
    safeFit();

    // Create WebSocket connection to ttyd backend
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Only attach addon when WebSocket is open
    ws.onopen = () => {
      if (isDisposedRef.current) {
        ws.close();
        return;
      }
      const attachAddon = new AttachAddon(ws);
      term.loadAddon(attachAddon);
      // Fit again after connection established
      safeFit();
    };

    ws.onerror = (event) => {
      if (!isDisposedRef.current) {
        console.warn('WebSocket error:', event);
      }
    };

    // Handle context menu for copying selected text
    const handleContextMenu = async (event: MouseEvent) => {
      if (isDisposedRef.current) return;
      event.preventDefault();

      try {
        const selection = term.getSelection();
        if (selection && selection.trim()) {
          await navigator.clipboard.writeText(selection);
        }
      } catch (err) {
        // Silently ignore clipboard errors
        console.error('Failed to copy to clipboard:', err);
      }
    };

    // Attach to the terminal element
    const termElement = terminalRef.current;
    termElement?.addEventListener('contextmenu', handleContextMenu);

    // Handle window resize to fit terminal
    const handleResize = () => safeFit();
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      isDisposedRef.current = true;
      window.removeEventListener('resize', handleResize);
      termElement?.removeEventListener('contextmenu', handleContextMenu);

      // Only close WebSocket if it's connecting or open
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      // Dispose terminal
      term.dispose();

      // Clear refs
      terminalInstanceRef.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
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
