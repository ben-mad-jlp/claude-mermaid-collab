import { WebSocketClient, getWebSocketClient } from './websocket.js';

// Cache for cross-origin per-server clients, keyed by server.id (or host:port fallback)
const frameClientCache = new Map<string, WebSocketClient>();

/**
 * Build the WS URL for a given server.
 * Same-origin (or no server): mirrors getDefaultWebSocketURL() from websocket.ts.
 * Cross-origin: explicit host:port.
 */
export function frameWsUrl(server?: { host: string; port: number }): string {
  if (typeof window === 'undefined') {
    return 'ws://localhost:9002/ws';
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!server || `${server.host}:${server.port}` === window.location.host) {
    return `${proto}//${window.location.host}/ws`;
  }
  return `${proto}//${server.host}:${server.port}/ws`;
}

/**
 * Return the WebSocketClient bound to the given server (C3: per-server, not global singleton).
 *
 * Same-origin path: returns the existing shared singleton (getWebSocketClient()) —
 * it IS that server's connection in the streamed-panel same-origin deployment.
 *
 * Cross-origin path: lazily creates and caches a new WebSocketClient per server.id,
 * calls connect() once, and reuses on subsequent calls.
 *
 * Known gap: cross-origin servers protected by Authorization headers cannot be
 * reached over a browser WS (no custom headers on WS handshake). The shipping
 * streamed-panel target is same-origin, so this is deferred.
 */
export function getFrameClient(server?: { id?: string; host: string; port: number }): WebSocketClient {
  if (typeof window === 'undefined') {
    return getWebSocketClient();
  }

  const isSameOrigin = !server || `${server.host}:${server.port}` === window.location.host;

  if (isSameOrigin) {
    return getWebSocketClient();
  }

  // Cross-origin: need a dedicated client per server
  const key = server.id ?? `${server.host}:${server.port}`;
  if (!frameClientCache.has(key)) {
    const client = new WebSocketClient(frameWsUrl(server));
    frameClientCache.set(key, client);
    client.connect();
  }
  return frameClientCache.get(key)!;
}

/** For testing: clear the cross-origin client cache. */
export function resetFrameClientCache(): void {
  frameClientCache.clear();
}
