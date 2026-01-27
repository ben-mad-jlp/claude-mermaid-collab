import React, { useEffect, useRef, useCallback } from 'react';
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
  const isInitializedRef = useRef(false);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    // Reset flags
    isDisposedRef.current = false;
    isInitializedRef.current = false;

    let term: Terminal | null = null;
    let ws: WebSocket | null = null;
    let fitAddon: FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;

    // Safe fit function
    const safeFit = () => {
      if (isDisposedRef.current || !fitAddon || !term) return;
      try {
        fitAddon.fit();
      } catch (e) {
        // Silently ignore fit errors
      }
    };

    // Initialize terminal when container has dimensions
    const initializeTerminal = () => {
      if (isInitializedRef.current || isDisposedRef.current) return;

      // Check if container has dimensions
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      isInitializedRef.current = true;

      // Create terminal instance
      term = new Terminal({
        rightClickSelectsWord: false,
        cols: 80,
        rows: 24,
        cursorBlink: true,
        cursorStyle: 'block',
      });

      terminalInstanceRef.current = term;

      // Create FitAddon
      fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      term.loadAddon(fitAddon);

      // Open terminal in DOM
      term.open(container);

      // Initial fit
      safeFit();

      // Create WebSocket connection
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDisposedRef.current || !term) {
          ws?.close();
          return;
        }
        const attachAddon = new AttachAddon(ws!);
        term.loadAddon(attachAddon);
        safeFit();
      };

      ws.onerror = () => {
        // Silently ignore WebSocket errors (logged by browser)
      };
    };

    // Use ResizeObserver to detect when container has dimensions
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          if (!isInitializedRef.current) {
            initializeTerminal();
          } else {
            safeFit();
          }
        }
      }
    });

    resizeObserver.observe(container);

    // Also try to initialize immediately if container already has dimensions
    requestAnimationFrame(() => {
      if (!isDisposedRef.current && !isInitializedRef.current) {
        initializeTerminal();
      }
    });

    // Context menu handler
    const handleContextMenu = async (event: MouseEvent) => {
      if (isDisposedRef.current || !term) return;
      event.preventDefault();

      try {
        const selection = term.getSelection();
        if (selection && selection.trim()) {
          await navigator.clipboard.writeText(selection);
        }
      } catch (err) {
        // Silently ignore clipboard errors
      }
    };

    container.addEventListener('contextmenu', handleContextMenu);

    // Window resize handler
    const handleResize = () => safeFit();
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      isDisposedRef.current = true;

      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('contextmenu', handleContextMenu);

      // Close WebSocket if it's connecting or open
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        ws.close();
      }

      // Dispose terminal
      if (term) {
        term.dispose();
      }

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
