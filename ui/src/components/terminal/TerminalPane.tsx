import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getTerminalWebSocketURL } from '@/lib/terminal-ws';

type ConnState = 'connecting' | 'connected' | 'disconnected';

/**
 * xterm.js terminal bound to a server-side Bun PTY over /terminal/:sessionId.
 *
 * The WS protocol is a JSON envelope ({type:'input'|'resize'} ↔
 * {type:'output'|'exit'|'error'}), so we wire messages manually rather than
 * using addon-attach (which pipes raw bytes). The server defers its buffer
 * replay until the first resize, so we send an initial resize on open.
 *
 * Robustness: a terminal whose WS fails before it establishes (no tmux to
 * attach to, orphaned pane after a server restart, transient 1006 close) must
 * NOT crash the pane. We (a) defer xterm open()/fit() until the container is
 * actually mounted and sized so the renderer/viewport never runs
 * syncScrollArea against undefined dimensions, (b) flip to a 'disconnected'
 * state and stop driving xterm on WS error/close, and (c) wrap the whole pane
 * in an error boundary so any residual xterm throw degrades gracefully.
 */
function TerminalPaneInner({
  sessionId,
  serverId,
  onConnChange,
}: {
  sessionId: string;
  serverId: string;
  onConnChange?: (state: ConnState) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [conn, setConn] = useState<ConnState>('connecting');

  useEffect(() => {
    onConnChange?.(conn);
  }, [conn, onConnChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setConn('connecting');

    const term = new Terminal({
      // NB: do NOT set convertEol — the PTY/tmux already emits explicit \r\n.
      // convertEol rewrites bare \n into \r\n, which forces the cursor to
      // column 0 when a full-screen TUI (Claude Code's input box) only meant
      // to move down a row, smearing the box's left border (`│ `) into the
      // indent of each new line.
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
      theme: { background: '#0d1117', foreground: '#c9d1d9' },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Lifecycle guards. `disposed` blocks every xterm op after teardown (the
    // ResizeObserver/WS callbacks can fire on a torn-down term). `opened`
    // gates fit()/write() until term.open() has actually attached xterm to a
    // sized element — fitting/writing before that is what drives
    // Viewport.syncScrollArea into reading undefined renderer dimensions.
    let disposed = false;
    let opened = false;

    const hasSize = () => {
      const el = containerRef.current;
      return !!el && el.clientWidth > 0 && el.clientHeight > 0;
    };

    // Only open once the container is mounted AND sized. xterm initializes its
    // renderer/viewport at open() time; doing so against a 0x0 element leaves
    // dimensions undefined and the first fit/scroll throws.
    const tryOpen = () => {
      if (disposed || opened || !hasSize()) return;
      const el = containerRef.current;
      if (!el) return;
      try {
        term.open(el);
        opened = true;
      } catch (err) {
        console.error('[TerminalPane] xterm open failed', sessionId, err);
      }
    };

    // Fit is safe only when attached (opened + term.element present) and sized.
    const safeFit = (): boolean => {
      if (disposed || !opened || !hasSize() || !term.element) return false;
      try {
        fit.fit();
        return true;
      } catch {
        // Renderer not ready yet (dimensions undefined) — skip rather than throw.
        return false;
      }
    };

    const ws = new WebSocket(getTerminalWebSocketURL(serverId, sessionId));
    const send = (msg: unknown) => {
      if (!disposed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    // The server defers its buffer replay until the FIRST resize, so that first
    // resize must carry the real container-fitted size — not xterm's 80x24
    // default. On (re)mount (e.g. switching terminal tabs) the container is
    // often 0x0 for a frame; sending 80x24 then makes Claude Code's full-screen
    // TUI replay at the wrong width and render jumbled. So we hold the initial
    // resize until the container has been measured at a non-zero size.
    let wsOpen = false;
    let sentInitial = false;
    const trySendInitial = () => {
      if (disposed || sentInitial || !wsOpen || !hasSize()) return;
      tryOpen();
      if (!safeFit()) return;
      if (term.cols > 0 && term.rows > 0) {
        send({ type: 'resize', cols: term.cols, rows: term.rows, isInitial: true });
        sentInitial = true;
      }
    };

    ws.onopen = () => {
      if (disposed) return;
      wsOpen = true;
      setConn('connected');
      trySendInitial();
    };
    ws.onerror = (e) => {
      if (disposed) return;
      console.error('[TerminalPane] WS error', sessionId, e);
      // A failed connection should degrade, not throw: stop driving xterm and
      // surface a disconnected state the user can retry from.
      wsOpen = false;
      setConn('disconnected');
    };
    ws.onclose = (e) => {
      if (disposed) return;
      // Keep only the close-with-error log; clean close is too noisy.
      if (!e.wasClean) {
        console.warn('[TerminalPane] WS unclean close', sessionId, { code: e.code, reason: e.reason });
        wsOpen = false;
        setConn('disconnected');
      }
    };
    ws.onmessage = (e) => {
      if (disposed) return;
      try {
        const msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
        // Ensure xterm is attached before writing; writing into an unopened
        // terminal can leave the viewport in the undefined-dimensions state.
        if (!opened) tryOpen();
        if (!opened) return;
        if (msg.type === 'output') term.write(msg.data);
        else if (msg.type === 'exit') term.write(`\r\n\x1b[90m[process exited: ${msg.code}]\x1b[0m\r\n`);
        else if (msg.type === 'error') term.write(`\r\n\x1b[31m[error: ${msg.message}]\x1b[0m\r\n`);
      } catch { /* ignore non-JSON frames */ }
    };

    const onData = term.onData((data) => send({ type: 'input', data }));

    const doFit = () => {
      if (disposed) return;
      // Skip while hidden/zero-sized (e.g. a tab being torn down) — fitting at
      // 0x0 clamps the terminal to a tiny size and would resize the backing
      // tmux pane, corrupting the TUI.
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

    return () => {
      disposed = true;
      observer.disconnect();
      onData.dispose();
      try { ws.close(); } catch { /* ignore */ }
      try { term.dispose(); } catch { /* guard double/partial dispose */ }
    };
  }, [sessionId, serverId]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {conn === 'disconnected' && <DisconnectedOverlay sessionId={sessionId} />}
    </div>
  );
}

function DisconnectedOverlay({ sessionId }: { sessionId: string }) {
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
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
        fontSize: 13,
      }}
    >
      <div style={{ color: '#f85149' }}>Terminal disconnected</div>
      <div style={{ color: '#8b949e', fontSize: 12 }}>The connection closed or could not be established.</div>
    </div>
  );
}

/**
 * Error boundary local to a single terminal pane. If xterm throws despite the
 * guards above (renderer edge cases on teardown), it degrades to a failed
 * state instead of crashing the surrounding UI. The user can retry, which
 * remounts the inner pane with a fresh xterm/WS via the changed key.
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
    console.error('[TerminalPane] render error', error);
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
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
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

export function TerminalPane({ sessionId, serverId }: { sessionId: string; serverId: string }) {
  // Bumping the key remounts the inner pane (fresh xterm + WS) on retry.
  const [attempt, setAttempt] = useState(0);
  return (
    <TerminalErrorBoundary key={attempt} onRetry={() => setAttempt((n) => n + 1)}>
      <TerminalPaneInner key={attempt} sessionId={sessionId} serverId={serverId} />
    </TerminalErrorBoundary>
  );
}
