/**
 * Build the WebSocket URL for a PTY terminal session on a specific server.
 *
 * In the native app, all WS traffic rides the main-process proxy on the
 * document origin. Per-server terminal tabs use the `/_per-server/<serverId>/`
 * prefix so the main-process bridge can resolve the right upstream + token
 * regardless of which server is currently "active".
 */
/**
 * The stable PTY id for THE single persistent, re-pointable console on a given
 * server. The console opens ONE WebSocket per server to this fixed id (each
 * server has its own backend + PTYManager, so a fixed id is unique per server)
 * and re-points it between tmux targets with `switch` messages — instead of the
 * old model that minted a fresh per-UUID PTY for every opened session. Attaching
 * to this id auto-creates a bare host shell that `switchTarget` drives, and a
 * bare shell is never reaped on detach, so it survives across switches.
 */
export const PERSISTENT_CONSOLE_PTY_ID = 'mc-persistent-console';

/**
 * Escape sequence written to xterm to clear any sticky terminal modes the
 * PREVIOUS session's TUI left behind, before the next session's stream is fed
 * in. Without this, a prior full-screen TUI's alt-screen / mouse-tracking /
 * bracketed-paste modes bleed into the next session (e.g. the wheel keeps
 * sending arrow keys — "mouse-off"). Paired with `term.reset()`: reset clears
 * xterm's buffer + most state, and this re-asserts the modes off explicitly so
 * tmux's attach-redraw repaints onto a clean slate.
 */
export const TERMINAL_MODE_RESET =
  '\x1b[?1049l' +                               // leave alt-screen buffer
  '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l' + // mouse tracking off (all encodings)
  '\x1b[?2004l' +                               // bracketed paste off
  '\x1b[!p';                                    // DECSTR — soft terminal reset

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
