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

/**
 * The tmux target a persistent PTY can be re-pointed at. Mirrors the backend
 * `TmuxTarget` (src/terminal/PTYManager.ts) — kept as a structural copy so the
 * UI bundle doesn't import server code.
 */
export interface TmuxTarget {
  base: string;
  grouped?: string;
}

/**
 * Terminal WebSocket protocol — the contract every later console leaf builds on.
 *
 * The console keeps ONE persistent PTY per server and switches which tmux target
 * it shows by sending a `switch` message, rather than tearing down the socket
 * and opening a new per-UUID PTY. The server acks with `switched`.
 */
export type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number; isInitial?: boolean }
  | { type: 'switch'; serverId: string; sessionId: string };

export type TerminalServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'switched'; target: TmuxTarget }
  | { type: 'error'; message: string };

/**
 * Build the `switch` message that re-points the persistent PTY at the
 * (serverId, sessionId) target. Send the result (JSON-serialized) over the
 * terminal WebSocket — the connection stays open across the switch.
 */
export function makeSwitchMessage(serverId: string, sessionId: string): TerminalClientMessage {
  return { type: 'switch', serverId, sessionId };
}
