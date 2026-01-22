/**
 * useWebSocket Hook
 *
 * Provides React integration for WebSocket connectivity with:
 * - Automatic connection/disconnection on mount/unmount
 * - Connection state tracking (connecting, connected, disconnected, error)
 * - Subscription and unsubscription helpers
 * - Message sending capability
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { WebSocketClient, WebSocketMessage, getWebSocketClient, resetWebSocketClient } from '../lib/websocket';

export interface UseWebSocketState {
  isConnecting: boolean;
  isConnected: boolean;
  error: Error | null;
}

export interface UseWebSocketReturn extends UseWebSocketState {
  send: (message: WebSocketMessage) => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
}

/**
 * Hook for managing WebSocket connections
 *
 * Automatically connects on mount and disconnects on unmount
 * Provides methods to send messages and manage subscriptions
 *
 * @param url - Optional WebSocket URL (uses default if not provided)
 * @param autoConnect - Whether to automatically connect on mount (default: true)
 * @returns WebSocket state and control methods
 *
 * @example
 * ```tsx
 * function Component() {
 *   const { isConnected, send, subscribe, error } = useWebSocket();
 *
 *   useEffect(() => {
 *     if (isConnected) {
 *       subscribe('diagrams');
 *     }
 *   }, [isConnected, subscribe]);
 *
 *   if (error) return <div>Connection error: {error.message}</div>;
 *   if (!isConnected) return <div>Connecting...</div>;
 *
 *   return <div>Connected</div>;
 * }
 * ```
 */
export function useWebSocket(
  url?: string,
  autoConnect: boolean = true
): UseWebSocketReturn {
  const clientRef = useRef<WebSocketClient | null>(null);
  const [state, setState] = useState<UseWebSocketState>({
    isConnecting: false,
    isConnected: false,
    error: null,
  });

  // Get or create WebSocket client
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = url ? new WebSocketClient(url) : getWebSocketClient();
    }
    return clientRef.current;
  }, [url]);

  // Connect to WebSocket
  const connect = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isConnecting: true, error: null }));
      const client = getClient();
      await client.connect();
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        isConnected: true,
        error: null,
      }));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        isConnected: false,
        error: err,
      }));
    }
  }, [getClient]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    const client = getClient();
    client.disconnect();
    setState((prev) => ({
      ...prev,
      isConnected: false,
      error: null,
    }));
  }, [getClient]);

  // Send a message
  const send = useCallback(
    (message: WebSocketMessage) => {
      const client = getClient();
      client.send(message);
    },
    [getClient]
  );

  // Subscribe to a channel
  const subscribe = useCallback(
    (channel: string) => {
      const client = getClient();
      client.subscribe(channel);
    },
    [getClient]
  );

  // Unsubscribe from a channel
  const unsubscribe = useCallback(
    (channel: string) => {
      const client = getClient();
      client.unsubscribe(channel);
    },
    [getClient]
  );

  // Setup connection listeners and auto-connect on mount
  useEffect(() => {
    const client = getClient();

    // Setup event listeners
    const connectSub = client.onConnect(() => {
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        isConnected: true,
        error: null,
      }));
    });

    const disconnectSub = client.onDisconnect(() => {
      setState((prev) => ({
        ...prev,
        isConnected: false,
      }));
    });

    // Auto-connect if requested
    if (autoConnect && !client.isConnected()) {
      connect().catch((error) => {
        console.error('Failed to auto-connect WebSocket:', error);
      });
    } else if (client.isConnected()) {
      setState((prev) => ({
        ...prev,
        isConnected: true,
      }));
    }

    // Cleanup on unmount
    return () => {
      connectSub.unsubscribe();
      disconnectSub.unsubscribe();
      // Don't disconnect automatically - let it persist across component re-renders
      // Only disconnect when the app unmounts or explicitly requested
    };
  }, [autoConnect, connect, getClient]);

  return {
    ...state,
    send,
    subscribe,
    unsubscribe,
    connect,
    disconnect,
  };
}
