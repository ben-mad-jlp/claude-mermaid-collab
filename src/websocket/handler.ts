import type { ServerWebSocket } from 'bun';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationData {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration: number;
  timestamp: number;
}

export type WSMessage =
  | { type: 'connected'; diagramCount: number }
  | { type: 'diagram_updated'; id: string; content: string; lastModified: number; patch?: { oldString: string; newString: string } }
  | { type: 'diagram_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'diagram_deleted'; id: string }
  | { type: 'document_updated'; id: string; content: string; lastModified: number; patch?: { oldString: string; newString: string } }
  | { type: 'document_created'; id: string; name: string; content: string; lastModified: number; project: string; session: string }
  | { type: 'document_deleted'; id: string }
  | { type: 'metadata_updated'; itemId?: string; updates?: Record<string, unknown>; foldersChanged?: boolean }
  | { type: 'subscribe'; id?: string; channel?: string }
  | { type: 'unsubscribe'; id?: string; channel?: string }
  | { type: 'question_responded'; questionId: string; response: string; project: string; session: string }
  | { type: 'ui_render'; uiId: string; project: string; session: string; ui: any; blocking: boolean; timestamp: number }
  | { type: 'ui_dismissed'; project: string; session: string }
  | { type: 'ui_updated'; patch: Record<string, unknown>; project: string; session: string }
  | { type: 'session_created'; project: string; session: string }
  | { type: 'notification'; data: NotificationData }
  | { type: 'status_changed'; status: 'working' | 'waiting' | 'idle'; message?: string; lastActivity: string }
  | { type: 'session_state_updated'; lastActivity: string; currentItem: number | null; completedTasks?: string[]; pendingTasks?: string[]; totalItems?: number; documentedItems?: number };

export class WebSocketHandler {
  private connections: Set<ServerWebSocket<{ subscriptions: Set<string> }>> = new Set();

  handleConnection(ws: ServerWebSocket<{ subscriptions: Set<string> }>): void {
    ws.data.subscriptions = new Set();
    this.connections.add(ws);
  }

  handleDisconnection(ws: ServerWebSocket<{ subscriptions: Set<string> }>): void {
    this.connections.delete(ws);
  }

  handleMessage(ws: ServerWebSocket<{ subscriptions: Set<string> }>, message: string): void {
    try {
      const data = JSON.parse(message) as WSMessage;

      if (data.type === 'subscribe') {
        if (data.id) {
          // Specific item subscription (existing behavior)
          ws.data.subscriptions.add(data.id);
        } else if (data.channel) {
          // General channel subscription (new)
          ws.data.subscriptions.add(`channel:${data.channel}`);
        }
      } else if (data.type === 'unsubscribe') {
        if (data.id) {
          ws.data.subscriptions.delete(data.id);
        } else if (data.channel) {
          ws.data.subscriptions.delete(`channel:${data.channel}`);
        }
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  broadcast(message: WSMessage): void {
    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      try {
        ws.send(json);
      } catch (error) {
        // Track dead connections to clean up
        deadConnections.push(ws);
        console.error('Failed to send WebSocket message:', error);
      }
    }

    // Clean up disconnected clients to prevent memory leaks
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
  }

  broadcastToDiagram(id: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(id)) {
        try {
          ws.send(json);
        } catch (error) {
          deadConnections.push(ws);
          console.error('Failed to send diagram message:', error);
        }
      }
    }

    // Clean up disconnected clients
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
  }

  broadcastToDocument(id: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(id)) {
        try {
          ws.send(json);
        } catch (error) {
          deadConnections.push(ws);
          console.error('Failed to send document message:', error);
        }
      }
    }

    // Clean up disconnected clients
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
  }

  broadcastNotification(notificationData: NotificationData): void {
    const message: WSMessage = {
      type: 'notification',
      data: notificationData,
    };

    const json = JSON.stringify(message);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      try {
        ws.send(json);
      } catch (error) {
        // Track dead connections to clean up
        deadConnections.push(ws);
        console.error('Failed to send notification message:', error);
      }
    }

    // Clean up disconnected clients to prevent memory leaks
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
  }

  broadcastStatus(status: 'working' | 'waiting' | 'idle', message?: string, lastActivity?: string): void {
    const message_obj: WSMessage = {
      type: 'status_changed',
      status,
      message,
      lastActivity: lastActivity || new Date().toISOString(),
    };

    const json = JSON.stringify(message_obj);
    const deadConnections: ServerWebSocket<{ subscriptions: Set<string> }>[] = [];

    for (const ws of this.connections) {
      try {
        ws.send(json);
      } catch (error) {
        // Track dead connections to clean up
        deadConnections.push(ws);
        console.error('Failed to send status message:', error);
      }
    }

    // Clean up disconnected clients to prevent memory leaks
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
