/**
 * Build the WebSocket URL for a PTY terminal session on a specific server.
 *
 * In the native app, all WS traffic rides the main-process proxy on the
 * document origin. Per-server terminal tabs use the `/_per-server/<serverId>/`
 * prefix so the main-process bridge can resolve the right upstream + token
 * regardless of which server is currently "active".
 */
export function getTerminalWebSocketURL(serverId: string, ptyId: string): string {
  if (typeof window === 'undefined') {
    // Tests / SSR: keep the legacy single-server shape — tests aren't cross-server.
    return `ws://localhost:9002/terminal/${encodeURIComponent(ptyId)}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/_per-server/${encodeURIComponent(serverId)}/terminal/${encodeURIComponent(ptyId)}`;
}
