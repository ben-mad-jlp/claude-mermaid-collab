import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import type { TerminalConfig, TerminalState } from '../types/terminal';

export function useTerminal(config: TerminalConfig) {
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [state, setState] = useState<TerminalState>({
    connected: false,
    error: null,
  });

  const createTerminal = () => {
    if (terminalRef.current) {
      return;
    }

    const term = new Terminal({
      fontSize: config.fontSize || 14,
      fontFamily: config.fontFamily || 'monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    terminalRef.current = term;
  };

  const connectWebSocket = () => {
    if (wsRef.current) {
      return;
    }

    try {
      // ttyd requires the 'tty' subprotocol
      const ws = new WebSocket(config.wsUrl, ['tty']);

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setState({ connected: true, error: null });
        // Send initial resize message to ttyd
        if (terminalRef.current) {
          const cols = terminalRef.current.cols;
          const rows = terminalRef.current.rows;
          // ttyd resize command: '1' + JSON
          ws.send('1' + JSON.stringify({ columns: cols, rows: rows }));
        }
      };

      ws.onmessage = (event) => {
        if (terminalRef.current) {
          // ttyd sends data with command prefix
          // '0' = output, '1' = resize ack, '2' = client info
          if (event.data instanceof ArrayBuffer) {
            const data = new Uint8Array(event.data);
            const cmd = data[0];
            if (cmd === 48) { // '0' = output
              const text = new TextDecoder().decode(data.slice(1));
              terminalRef.current.write(text);
            }
          } else if (typeof event.data === 'string') {
            // Handle string data (fallback)
            if (event.data.charAt(0) === '0') {
              terminalRef.current.write(event.data.slice(1));
            }
          }
        }
      };

      ws.onerror = () => {
        setState({
          connected: false,
          error: 'Failed to connect to terminal',
        });
      };

      ws.onclose = () => {
        setState({ connected: false, error: null });
        wsRef.current = null;
      };

      wsRef.current = ws;
    } catch (error) {
      setState({
        connected: false,
        error: 'WebSocket connection failed',
      });
    }
  };

  const setupTerminalInput = () => {
    if (!terminalRef.current || !wsRef.current) {
      return;
    }

    terminalRef.current.onData((data: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // ttyd input format: '0' + data
        wsRef.current.send('0' + data);
      }
    });
  };

  const reconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState({ connected: false, error: null });
    connectWebSocket();
  };

  useEffect(() => {
    createTerminal();
    connectWebSocket();
    setupTerminalInput();

    // Handle window resize
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        try {
          fitAddonRef.current.fit();
          // Send resize to ttyd
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            const cols = terminalRef.current.cols;
            const rows = terminalRef.current.rows;
            wsRef.current.send('1' + JSON.stringify({ columns: cols, rows: rows }));
          }
        } catch (e) {
          // Terminal not yet mounted, ignore
        }
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    terminalRef,
    isConnected: state.connected,
    error: state.error,
    reconnect,
  };
}
