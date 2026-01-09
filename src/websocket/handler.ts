import type { ServerWebSocket } from 'bun';

export type WSMessage =
  | { type: 'connected'; diagramCount: number }
  | { type: 'diagram_updated'; id: string; content: string; lastModified: number }
  | { type: 'diagram_created'; id: string; name: string }
  | { type: 'diagram_deleted'; id: string }
  | { type: 'subscribe'; id: string }
  | { type: 'unsubscribe'; id: string };

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
        ws.data.subscriptions.add(data.id);
      } else if (data.type === 'unsubscribe') {
        ws.data.subscriptions.delete(data.id);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  broadcast(message: WSMessage): void {
    const json = JSON.stringify(message);
    for (const ws of this.connections) {
      ws.send(json);
    }
  }

  broadcastToDiagram(id: string, message: WSMessage): void {
    const json = JSON.stringify(message);
    for (const ws of this.connections) {
      if (ws.data.subscriptions.has(id)) {
        ws.send(json);
      }
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
