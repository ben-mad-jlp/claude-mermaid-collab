/**
 * WebSocket Handler Manager
 *
 * Provides a singleton instance of the WebSocket handler for use across the application.
 * This allows MCP tools to broadcast messages without circular dependencies.
 */

import { WebSocketHandler } from '../websocket/handler.js';

let globalWsHandler: WebSocketHandler | null = null;

export function initializeWebSocketHandler(handler: WebSocketHandler): void {
  globalWsHandler = handler;
}

export function getWebSocketHandler(): WebSocketHandler | null {
  return globalWsHandler;
}

export function hasWebSocketHandler(): boolean {
  return globalWsHandler !== null;
}
