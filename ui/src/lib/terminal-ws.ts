/**
 * Build the WebSocket URL for a PTY terminal session. Derived from the document
 * origin (in the native app that's the main-process proxy), matching the collab
 * WS pattern in websocket.ts — so the terminal rides the active-server switch.
 */
export function getTerminalWebSocketURL(sessionId: string): string {
  if (typeof window === 'undefined') {
    return `ws://localhost:9002/terminal/${encodeURIComponent(sessionId)}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/terminal/${encodeURIComponent(sessionId)}`;
}
