/**
 * WebSocket Client with Automatic Reconnection
 *
 * This module provides a WebSocket client that:
 * - Connects to the mermaid-collab server
 * - Handles automatic reconnection on disconnect
 * - Provides message subscription/publishing
 * - Supports event emitter pattern for lifecycle events
 *
 * Used for real-time updates from server:
 * - Diagram updates
 * - Document updates
 * - Question events from Claude
 */

/**
 * Message structure for WebSocket communication
 */
export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * WebSocket message types that should dispatch CustomEvents
 */
const BROADCAST_MESSAGE_TYPES = ['status_changed', 'session_state_updated', 'task_graph_updated'] as const;
type BroadcastMessageType = typeof BROADCAST_MESSAGE_TYPES[number];

/**
 * Status changed event detail
 */
export interface StatusChangedDetail {
  project: string;
  session: string;
  status: unknown;
}

/**
 * Session state updated event detail
 */
export interface SessionStateUpdatedDetail {
  project: string;
  session: string;
  state: unknown;
}

/**
 * Task graph updated event detail
 */
export interface TaskGraphUpdatedDetail {
  project: string;
  session: string;
  payload: {
    diagram: string;
    batches: unknown[];
    completedTasks: string[];
    pendingTasks: string[];
    updatedTaskId: string;
    updatedStatus: string;
  };
}

/**
 * Dispatch a CustomEvent to window for a WebSocket message.
 * Allows React hooks to subscribe without direct WebSocket access.
 *
 * @param type - The broadcast message type (status_changed or session_state_updated)
 * @param detail - The event detail data
 */
export function dispatchWebSocketEvent(type: BroadcastMessageType, detail: unknown): void {
  const event = new CustomEvent(type, { detail });
  window.dispatchEvent(event);
}

/**
 * Handler function for WebSocket messages
 */
export type MessageHandler = (message: WebSocketMessage) => void;

/**
 * Event handler for lifecycle events
 */
export type EventHandler = () => void;

/**
 * Subscription handle for unsubscribing from messages
 */
export interface Subscription {
  unsubscribe: () => void;
}

/**
 * WebSocket client with reconnection logic
 *
 * Example usage:
 * ```typescript
 * const ws = new WebSocketClient('ws://localhost:3737/ws');
 *
 * // Listen for connection
 * ws.onConnect(() => {
 *   console.log('Connected');
 *   ws.send({ type: 'subscribe', channel: 'diagrams' });
 * });
 *
 * // Listen for messages
 * const unsub = ws.onMessage((msg) => {
 *   if (msg.type === 'diagram_updated') {
 *     console.log('Diagram updated:', msg);
 *   }
 * });
 *
 * // Connect
 * await ws.connect();
 *
 * // Later: unsubscribe
 * unsub();
 *
 * // Disconnect
 * ws.disconnect();
 * ```
 */
export class WebSocketClient {
  private socket: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start at 1 second
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectHandlers: Set<EventHandler> = new Set();
  private disconnectHandlers: Set<EventHandler> = new Set();
  private isIntentionallyClosed = false;
  private pendingMessages: WebSocketMessage[] = [];
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to the WebSocket server
   * Resolves when connection is established
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.url);

        // Connection established
        this.socket.onopen = () => {
          this.reconnectAttempts = 0;
          this.isIntentionallyClosed = false;

          // Send any pending messages
          this.flushPendingMessages();

          // Notify listeners
          this.connectHandlers.forEach((handler) => handler());

          resolve();
        };

        // Message received
        this.socket.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);

            // Bridge broadcast messages to CustomEvents
            if (message.type === 'status_changed') {
              dispatchWebSocketEvent('status_changed', {
                project: message.project,
                session: message.session,
                status: message.status,
              });
            } else if (message.type === 'session_state_updated') {
              dispatchWebSocketEvent('session_state_updated', {
                project: message.project,
                session: message.session,
                state: message.state,
              });
            } else if (message.type === 'task_graph_updated') {
              dispatchWebSocketEvent('task_graph_updated', {
                project: message.project,
                session: message.session,
                payload: message.payload,
              });
            }

            this.messageHandlers.forEach((handler) => handler(message));
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        // Connection closed
        this.socket.onclose = () => {
          this.onConnectionClosed();
        };

        // Error occurred
        this.socket.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   * Prevents automatic reconnection
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;

    // Clear any pending reconnection timeout
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  /**
   * Send a message to the server
   * Queues message if not connected
   */
  send(message: WebSocketMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      // Queue message for later delivery
      this.pendingMessages.push(message);
      return;
    }

    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
      // Queue for retry
      this.pendingMessages.push(message);
    }
  }

  /**
   * Subscribe to all messages
   * Returns unsubscribe function
   */
  onMessage(handler: MessageHandler): Subscription {
    this.messageHandlers.add(handler);

    return {
      unsubscribe: () => {
        this.messageHandlers.delete(handler);
      },
    };
  }

  /**
   * Listen for connection established event
   * Returns unsubscribe function
   */
  onConnect(handler: EventHandler): Subscription {
    this.connectHandlers.add(handler);

    return {
      unsubscribe: () => {
        this.connectHandlers.delete(handler);
      },
    };
  }

  /**
   * Listen for disconnection event
   * Returns unsubscribe function
   */
  onDisconnect(handler: EventHandler): Subscription {
    this.disconnectHandlers.add(handler);

    return {
      unsubscribe: () => {
        this.disconnectHandlers.delete(handler);
      },
    };
  }

  /**
   * Get current connection status
   */
  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Subscribe to a specific channel
   * Sends subscription message to server
   */
  subscribe(channel: string): void {
    this.send({
      type: 'subscribe',
      channel,
    });
  }

  /**
   * Unsubscribe from a specific channel
   * Sends unsubscription message to server
   */
  unsubscribe(channel: string): void {
    this.send({
      type: 'unsubscribe',
      channel,
    });
  }

  /**
   * Handle connection closed event
   * Triggers automatic reconnection if not intentionally closed
   */
  private onConnectionClosed(): void {
    this.socket = null;

    // Notify listeners of disconnection
    this.disconnectHandlers.forEach((handler) => handler());

    // Attempt to reconnect if not intentionally closed
    if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt
   * Uses exponential backoff: 1s, 2s, 4s, 8s, 16s
   */
  private scheduleReconnect(): void {
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(
      `WebSocket reconnection scheduled in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect().catch((error) => {
        console.error('WebSocket reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Send all pending messages that were queued while disconnected
   */
  private flushPendingMessages(): void {
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift();
      if (message) {
        this.send(message);
      }
    }
  }
}

/**
 * Create a shared WebSocket client instance
 * Follows singleton pattern for application-wide use
 */
let sharedClient: WebSocketClient | null = null;

/**
 * Get or create the shared WebSocket client
 */
export function getWebSocketClient(url: string = getDefaultWebSocketURL()): WebSocketClient {
  if (!sharedClient) {
    sharedClient = new WebSocketClient(url);
  }
  return sharedClient;
}

/**
 * Get the default WebSocket URL based on current location
 * Works in browser environment
 *
 * In development, Vite proxies /ws to the API server (port 3737)
 */
function getDefaultWebSocketURL(): string {
  if (typeof window === 'undefined') {
    // Server-side context (tests)
    return 'ws://localhost:3737/ws';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

/**
 * Reset the shared client (useful for testing)
 */
export function resetWebSocketClient(): void {
  if (sharedClient) {
    sharedClient.disconnect();
    sharedClient = null;
  }
}
