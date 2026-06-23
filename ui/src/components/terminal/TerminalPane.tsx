import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  getTerminalWebSocketURL,
  getConsolePtyId,
  makeSwitchMessage,
  TERMINAL_MODE_RESET,
} from '@/lib/terminal-ws';
import { useTerminalPalette } from './terminalTheme';

type ConnState = 'connecting' | 'connected' | 'disconnected';

/**
 * THE single persistent xterm console (replaces the old per-tab pane model).
 *
 * Instead of one xterm + WebSocket + PTY per opened session, the console keeps
 * ONE WebSocket per server — to this client's per-UI console PTY id — and
 * re-points it between tmux targets with `switch` messages. Selecting a
 * different session re-points the SAME connection (no teardown); selecting a
 * session on a different server reconnects the WebSocket through that server's
 * per-server proxy (the WS URL is namespaced by serverId).
 *
 * Two axes of change:
 *   - `serverId` change  → tear down + reopen the WebSocket (effect re-runs).
 *   - `tmuxBase`  change → re-point the live connection with a `switch` message.
 *
 * Clean re-point: before feeding the new session's stream we `term.reset()` and
 * write TERMINAL_MODE_RESET so the prior session's alt-screen / mouse-tracking
 * state can't bleed in; the server's switchTarget then does a tmux attach-redraw
 * (refresh-client -S) so the new pane repaints cleanly. (See the server
 * attach-redraw leaf — we deliberately lean on tmux's redraw, not a byte-replay.)
 *
 * Robustness (preserved from the prior pane): defer xterm open()/fit() until the
 * container is mounted and sized, flip to 'disconnected' on WS error/close
 * instead of throwing, and wrap in an error boundary so a residual xterm throw
 * degrades gracefully.
 */
function TerminalConsoleInner({
  serverId,
  tmuxBase,
  onConnChange,
}: {
  serverId: string;
  tmuxBase: string | null;
  onConnChange?: (state: ConnState) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const palette = useTerminalPalette();
  const [conn, setConn] = useState<ConnState>('connecting');

  // Live-update the xterm palette when the terminal theme changes — no teardown,
  // so scrollback + the WS survive a theme switch.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = {
        background: palette.bg,
        foreground: palette.fg,
        cursor: palette.cursor,
        cursorAccent: palette.bg,
      };
    }
  }, [palette]);

  // Latest requested target, readable from the WS onopen callback (which fires
  // asynchronously after the tmuxBase prop may have advanced).
  const tmuxBaseRef = useRef<string | null>(tmuxBase);
  tmuxBaseRef.current = tmuxBase;

  // Re-point hook published by the active connection effect; the tmuxBase effect
  // calls it to switch targets on the live WS without tearing it down.
  const repointRef = useRef<((target: string | null) => void) | null>(null);
  // Manual reconnect hook published by the effect; the disconnected overlay's
  // "Reconnect" button calls it to retry immediately (skip the backoff wait).
  const reconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onConnChange?.(conn);
  }, [conn, onConnChange]);

  // Per-server connection lifecycle: ONE xterm (kept alive across reconnects so
  // scrollback + sizing survive) and a WebSocket that AUTO-RECONNECTS with backoff.
  // The effect re-runs (full teardown) only when the server changes; a dropped
  // socket (sidecar restart, proxy blip) reconnects in place and re-syncs — instead
  // of leaving a blank pane behind a "connected"-looking xterm.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setConn('connecting');

    const term = new Terminal({
      // NB: do NOT set convertEol — the PTY/tmux already emits explicit \r\n.
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Symbols Nerd Font Mono", "Apple Color Emoji", monospace',
      // Initial palette; the [palette] effect live-updates it on a theme switch.
      theme: { background: palette.bg, foreground: palette.fg, cursor: palette.cursor, cursorAccent: palette.bg },
      cursorBlink: true,
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Lifecycle guards. `disposed` blocks every xterm op after teardown.
    // `opened` gates fit()/write() until term.open() has attached xterm to a
    // sized element (fitting/writing before that drives syncScrollArea into
    // reading undefined renderer dimensions).
    let disposed = false;
    let opened = false;
    // Per-CONNECTION state (reset on every (re)connect): the tmux target this
    // socket currently shows, and whether the replay-triggering initial resize
    // has been sent. Resetting these on reconnect forces a fresh re-sync + redraw.
    let currentTarget: string | null = null;
    let sentInitial = false;
    // Live socket + reconnect bookkeeping.
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    // Heartbeat: detect a HALF-OPEN socket (TCP stalled, no onclose) by pinging and
    // requiring a reply (pong, or any other frame) within a deadline.
    const HEARTBEAT_MS = 15_000;
    const PONG_TIMEOUT_MS = 8_000;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let pongTimer: ReturnType<typeof setTimeout> | null = null;
    const clearHeartbeat = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
    };

    const hasSize = () => {
      const el = containerRef.current;
      return !!el && el.clientWidth > 0 && el.clientHeight > 0;
    };

    const tryOpen = () => {
      if (disposed || opened || !hasSize()) return;
      const el = containerRef.current;
      if (!el) return;
      try {
        term.open(el);
        opened = true;
      } catch (err) {
        console.error('[TerminalConsole] xterm open failed', serverId, err);
      }
    };

    const safeFit = (): boolean => {
      if (disposed || !opened || !hasSize() || !term.element) return false;
      try {
        fit.fit();
        return true;
      } catch {
        return false;
      }
    };

    const wsOpen = () => !!ws && ws.readyState === WebSocket.OPEN;
    const send = (msg: unknown) => {
      if (!disposed && wsOpen()) ws!.send(JSON.stringify(msg));
    };

    // Re-point the live connection at a tmux target. Reset xterm cleanly BEFORE
    // sending the switch so prior-session state doesn't bleed; the server's
    // attach-redraw repaints the new target.
    const repoint = (target: string | null) => {
      if (disposed || !target || !wsOpen() || target === currentTarget) return;
      if (!opened) tryOpen();
      try {
        term.reset();
        term.write(TERMINAL_MODE_RESET);
      } catch { /* reset is best-effort */ }
      send(makeSwitchMessage(serverId, target));
      currentTarget = target;
    };
    repointRef.current = repoint;

    // The server defers buffer replay until the FIRST resize, so that first
    // resize must carry the real container-fitted size (not xterm's 80x24
    // default), else a full-screen TUI replays at the wrong width and renders
    // jumbled. Hold the initial resize until the container has a non-zero size.
    const trySendInitial = () => {
      if (disposed || sentInitial || !wsOpen() || !hasSize()) return;
      tryOpen();
      if (!safeFit()) return;
      if (term.cols > 0 && term.rows > 0) {
        send({ type: 'resize', cols: term.cols, rows: term.rows, isInitial: true });
        sentInitial = true;
      }
    };

    // Force a repaint after a re-point. The server's `attach \; refresh-client -S`
    // redraw is intermittently a no-op: a refresh at the SAME client size doesn't
    // emit SIGWINCH, so tmux doesn't relayout and the new target stays blank until
    // the user's next keystroke/scroll. A brief 1-row resize (shrink then restore)
    // guarantees two SIGWINCHes → tmux relayouts and repaints immediately. Pure
    // size nudge: non-initial resizes don't trigger buffer replay (see resize()).
    const nudgeRedraw = () => {
      if (disposed || !opened || !wsOpen()) return;
      if (!safeFit()) return;
      const cols = term.cols, rows = term.rows;
      if (cols < 1 || rows < 2) { send({ type: 'resize', cols, rows }); return; }
      send({ type: 'resize', cols, rows: rows - 1 });
      setTimeout(() => {
        if (disposed || !wsOpen()) return;
        send({ type: 'resize', cols, rows });
      }, 60);
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      // Exponential backoff capped at 10s — a sidecar restart recovers in seconds.
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 10_000);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      setConn('connecting');
      // Each connection re-syncs from scratch: re-send the initial resize (server
      // replays the buffer) and re-issue the switch (attach-redraw repaints).
      sentInitial = false;
      currentTarget = null;
      // Per-UI-instance console PTY id (stable per client via localStorage), so two
      // UIs on the same server get independent server-side consoles.
      const sock = new WebSocket(getTerminalWebSocketURL(serverId, getConsolePtyId()));
      ws = sock;

      // Heartbeat for THIS socket: ping on an interval; if nothing comes back within
      // the pong deadline, the socket is half-open → force a reconnect. ANY inbound
      // frame (output included) counts as liveness and clears the deadline.
      const startHeartbeat = () => {
        clearHeartbeat();
        heartbeatTimer = setInterval(() => {
          if (disposed || ws !== sock || !wsOpen()) return;
          send({ type: 'ping' });
          if (!pongTimer) {
            pongTimer = setTimeout(() => {
              pongTimer = null;
              if (disposed || ws !== sock) return;
              console.warn('[TerminalConsole] heartbeat timeout → forcing reconnect', serverId);
              clearHeartbeat();
              try { sock.onclose = null; sock.onerror = null; sock.close(); } catch { /* ignore */ }
              if (ws === sock) ws = null;
              setConn('disconnected');
              scheduleReconnect();
            }, PONG_TIMEOUT_MS);
          }
        }, HEARTBEAT_MS);
      };

      sock.onopen = () => {
        if (disposed || ws !== sock) return;
        reconnectAttempts = 0;
        setConn('connected');
        trySendInitial();
        // Point the freshly-opened connection at the currently-selected session.
        repoint(tmuxBaseRef.current);
        startHeartbeat();
      };
      sock.onerror = (e) => {
        if (disposed || ws !== sock) return;
        console.error('[TerminalConsole] WS error', serverId, e);
        setConn('disconnected');
        // onclose follows an error and is where we schedule the retry.
      };
      sock.onclose = (e) => {
        if (disposed || ws !== sock) return;
        clearHeartbeat();
        // A clean close is graceful (intentional server shutdown / our own close) —
        // leave it be. Only an UNCLEAN drop (sidecar restart, proxy blip → code 1006)
        // flips to disconnected and auto-reconnects.
        if (e.wasClean) return;
        console.warn('[TerminalConsole] WS unclean close → reconnecting', serverId, { code: e.code, reason: e.reason });
        setConn('disconnected');
        scheduleReconnect();
      };
      sock.onmessage = (e) => {
        if (disposed || ws !== sock) return;
        // Any inbound frame proves the socket is alive → clear the pong deadline.
        if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
        try {
          const msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
          if (msg.type === 'pong') return; // heartbeat ack — liveness only
          if (!opened) tryOpen();
          if (!opened) return;
          if (msg.type === 'output') term.write(msg.data);
          else if (msg.type === 'exit') term.write(`\r\n\x1b[90m[process exited: ${msg.code}]\x1b[0m\r\n`);
          else if (msg.type === 'error') term.write(`\r\n\x1b[31m[error: ${msg.message}]\x1b[0m\r\n`);
          else if (msg.type === 'switched') {
            // The server's attach-redraw is unreliable (same-size refresh-client is
            // a SIGWINCH no-op), so the new target can stay blank until first input.
            // Nudge a real resize once the attach/detach flush has settled.
            setTimeout(nudgeRedraw, 120);
          }
        } catch { /* ignore non-JSON frames */ }
      };
    };

    // Manual reconnect (overlay button): drop any pending backoff + retry now.
    reconnectRef.current = () => {
      if (disposed) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      clearHeartbeat();
      reconnectAttempts = 0;
      try { ws?.close(); } catch { /* ignore */ }
      connect();
    };

    const onData = term.onData((data) => send({ type: 'input', data }));

    const doFit = () => {
      if (disposed) return;
      if (!hasSize()) return;
      tryOpen();
      if (!sentInitial) { trySendInitial(); return; }
      if (safeFit()) send({ type: 'resize', cols: term.cols, rows: term.rows });
    };
    const observer = new ResizeObserver(doFit);
    observer.observe(container);
    // The container may already be sized on mount (no resize event coming).
    tryOpen();
    safeFit();
    connect();

    return () => {
      disposed = true;
      repointRef.current = null;
      reconnectRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearHeartbeat();
      observer.disconnect();
      onData.dispose();
      try { ws?.close(); } catch { /* ignore */ }
      try { term.dispose(); } catch { /* guard double/partial dispose */ }
      if (termRef.current === term) termRef.current = null;
    };
    // palette intentionally excluded — the [palette] effect live-updates the theme
    // without tearing down the connection (which would drop scrollback + the WS).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  // Re-point the live connection when the selected session changes (same server).
  // On a server change the connection effect above re-runs and repoints in its
  // onopen, so this is the same-server fast path.
  useEffect(() => {
    repointRef.current?.(tmuxBase);
  }, [tmuxBase]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {conn === 'disconnected' && <DisconnectedOverlay onReconnect={() => reconnectRef.current?.()} />}
    </div>
  );
}

function DisconnectedOverlay({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div
      data-testid="terminal-disconnected"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        background: 'rgba(13, 17, 23, 0.85)',
        color: '#c9d1d9',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Symbols Nerd Font Mono", "Apple Color Emoji", monospace',
        fontSize: 13,
      }}
    >
      <div style={{ color: '#f85149' }}>Terminal disconnected</div>
      <div style={{ color: '#8b949e', fontSize: 12 }}>Reconnecting automatically…</div>
      <button
        type="button"
        onClick={onReconnect}
        style={{
          marginTop: 4,
          padding: '4px 12px',
          background: '#21262d',
          color: '#c9d1d9',
          border: '1px solid #30363d',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Reconnect now
      </button>
    </div>
  );
}

/**
 * Error boundary local to the console. If xterm throws despite the guards
 * (renderer edge cases on teardown), degrade to a failed state instead of
 * crashing the surrounding UI. Retry bumps the key to remount with a fresh
 * xterm/WS.
 */
class TerminalErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onRetry: () => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[TerminalConsole] render error', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          data-testid="terminal-error"
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: '#0d1117',
            color: '#c9d1d9',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Symbols Nerd Font Mono", "Apple Color Emoji", monospace',
            fontSize: 13,
          }}
        >
          <div style={{ color: '#f85149' }}>Terminal failed to render</div>
          <button
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onRetry();
            }}
            style={{
              padding: '4px 12px',
              background: '#21262d',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * The single persistent console. `serverId` selects which server's PTY the WS
 * connects to; `tmuxBase` is the tmux session name of the currently-selected
 * collab session (null when nothing is selected yet).
 */
export function TerminalConsole({ serverId, tmuxBase }: { serverId: string; tmuxBase: string | null }) {
  // Bumping the key remounts the inner console (fresh xterm + WS) on retry.
  const [attempt, setAttempt] = useState(0);
  return (
    <TerminalErrorBoundary key={attempt} onRetry={() => setAttempt((n) => n + 1)}>
      <TerminalConsoleInner key={attempt} serverId={serverId} tmuxBase={tmuxBase} />
    </TerminalErrorBoundary>
  );
}
