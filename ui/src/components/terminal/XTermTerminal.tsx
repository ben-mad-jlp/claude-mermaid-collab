import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface XTermTerminalProps {
  /** WebSocket URL base for terminal connection (e.g., ws://localhost:3737/terminal) */
  wsUrl: string;
  /** Session ID to attach to (used in path: /terminal/:sessionId) */
  sessionId: string;
  className?: string;
}

/**
 * XTermTerminal - Native xterm.js terminal connected to Bun PTY backend
 *
 * Features:
 * - Text selection without auto-copy
 * - Right-click copies selected text to clipboard
 * - Connects to PTY sessions via WebSocket + Bun native PTY
 * - Responsive sizing with FitAddon
 * - JSON-based input/resize messages
 */
export const XTermTerminal = React.memo(function XTermTerminal({
  wsUrl,
  sessionId,
  className = '',
}: XTermTerminalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isDisposedRef = useRef(false);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const container = terminalRef.current;
    if (!wrapper || !container) return;

    // Reset flags
    isDisposedRef.current = false;
    isInitializedRef.current = false;

    let term: Terminal | null = null;
    let ws: WebSocket | null = null;
    let fitAddon: FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;

    // Send resize message to server
    const sendResize = (cols: number, rows: number, isInitial = false) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows, isInitial }));
      }
    };

    // Safe fit function that also sends resize to server
    // Uses refs instead of local variables to avoid stale closure issues
    let rafId: number | null = null;
    const safeFit = () => {
      const currentTerm = terminalInstanceRef.current;
      const currentFitAddon = fitAddonRef.current;
      if (isDisposedRef.current || !currentFitAddon || !currentTerm) {
        return;
      }

      // Validate container dimensions
      const container = terminalRef.current;
      if (container) {
        const { width, height } = container.getBoundingClientRect();
        if (width === 0 || height === 0) {
          return;
        }
      }

      // Cancel any pending fit to debounce rapid resize events
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      // Use double RAF for proper timing
      // First RAF: wait for browser to render
      rafId = requestAnimationFrame(() => {
        // Second RAF: wait for paint to complete before measuring
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const t = terminalInstanceRef.current;
          const f = fitAddonRef.current;
          if (isDisposedRef.current || !f || !t) return;
          try {
            f.fit();
            sendResize(t.cols, t.rows);
          } catch (e) {
            // Silently ignore fit errors
          }
        });
      });
    };

    // Initialize terminal when wrapper has dimensions
    const initializeTerminal = () => {
      if (isInitializedRef.current || isDisposedRef.current) return;

      // Check if wrapper has dimensions (container will match via absolute positioning)
      const { width, height } = wrapper.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      isInitializedRef.current = true;

      // Create terminal instance
      term = new Terminal({
        rightClickSelectsWord: false,
        cols: 80,
        rows: 24,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        smoothScrollDuration: 0,
        fastScrollSensitivity: 5,
        scrollSensitivity: 3,
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
        },
      });

      terminalInstanceRef.current = term;

      // Create FitAddon
      fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      term.loadAddon(fitAddon);

      // Open terminal in DOM
      term.open(container);

      // Initial fit
      try {
        fitAddon.fit();
      } catch (e) {
        // Ignore initial fit errors
      }

      // Build WebSocket URL with session ID in path: /terminal/:sessionId
      const url = new URL(`${wsUrl}/${encodeURIComponent(sessionId)}`, window.location.origin);

      // Create WebSocket connection
      ws = new WebSocket(url.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDisposedRef.current || !term) {
          ws?.close();
          return;
        }

        // IMPORTANT: Send resize FIRST before expecting any output
        // This ensures PTY dimensions are set before buffer replay
        sendResize(term.cols, term.rows, true);
      };

      ws.onmessage = (event) => {
        if (isDisposedRef.current || !term) return;

        // Parse JSON message from PTY backend
        const data = event.data;
        if (typeof data === 'string') {
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'output' && typeof msg.data === 'string') {
              term.write(msg.data);
            } else if (msg.type === 'exit') {
              term.write('\r\n\x1b[33mSession exited\x1b[0m\r\n');
            } else if (msg.type === 'error' && msg.message) {
              term.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
            }
          } catch {
            // If not JSON, write directly (fallback for raw output)
            term.write(data);
          }
        } else if (data instanceof Blob) {
          data.text().then(text => {
            if (!isDisposedRef.current && term) {
              try {
                const msg = JSON.parse(text);
                if (msg.type === 'output' && typeof msg.data === 'string') {
                  term.write(msg.data);
                }
              } catch {
                term.write(text);
              }
            }
          });
        }
      };

      ws.onerror = () => {
        // Silently ignore WebSocket errors (logged by browser)
      };

      ws.onclose = () => {
        if (!isDisposedRef.current && term) {
          term.write('\r\n\x1b[31mConnection closed\x1b[0m\r\n');
        }
      };

      // Forward terminal input to WebSocket using PTY protocol
      term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Handle terminal resize
      term.onResize(({ cols, rows }) => {
        sendResize(cols, rows, false);
      });
    };

    // Use ResizeObserver on wrapper to detect size changes
    // The wrapper is in the flex layout, so it gets size changes first
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

    resizeObserver.observe(wrapper);

    // Use IntersectionObserver to detect visibility changes
    // This handles the case when a hidden terminal becomes visible again
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 1.0 && isInitializedRef.current && !isDisposedRef.current) {
            // Terminal became fully visible, trigger a fit
            safeFit();
          }
        }
      },
      { threshold: 1.0 }
    );

    intersectionObserver.observe(wrapper);

    // Also try to initialize immediately if container already has dimensions
    requestAnimationFrame(() => {
      if (!isDisposedRef.current && !isInitializedRef.current) {
        initializeTerminal();
      }
    });

    // Context menu handler - copy selected text
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

    wrapper.addEventListener('contextmenu', handleContextMenu);

    // Wheel event handler - prevent scroll events from bubbling to parent
    const handleWheel = (event: WheelEvent) => {
      // Stop propagation to prevent parent containers from scrolling
      event.stopPropagation();
    };
    wrapper.addEventListener('wheel', handleWheel, { passive: true });

    // Window resize handler
    const handleResize = () => safeFit();
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      isDisposedRef.current = true;

      // Cancel pending RAF
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
      wrapper.removeEventListener('contextmenu', handleContextMenu);
      wrapper.removeEventListener('wheel', handleWheel);

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
  }, [wsUrl, sessionId]);

  return (
    <div
      ref={wrapperRef}
      data-testid="xterm-wrapper"
      className={className}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        width: '100%',
      }}
    >
      <div
        ref={terminalRef}
        data-testid="xterm-container"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#1e1e1e',
          overflow: 'hidden',
        }}
      />
    </div>
  );
});

XTermTerminal.displayName = 'XTermTerminal';
