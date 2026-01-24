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
      const ws = new WebSocket(config.wsUrl);

      ws.onopen = () => {
        setState({ connected: true, error: null });
      };

      ws.onmessage = (event) => {
        if (terminalRef.current) {
          terminalRef.current.write(event.data);
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
        wsRef.current.send(data);
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
