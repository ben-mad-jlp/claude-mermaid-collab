import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getTerminalWebSocketURL } from '@/lib/terminal-ws';

/**
 * xterm.js terminal bound to a server-side Bun PTY over /terminal/:sessionId.
 *
 * The WS protocol is a JSON envelope ({type:'input'|'resize'} ↔
 * {type:'output'|'exit'|'error'}), so we wire messages manually rather than
 * using addon-attach (which pipes raw bytes). The server defers its buffer
 * replay until the first resize, so we send an initial resize on open.
 */
export function TerminalPane({ sessionId, serverId }: { sessionId: string; serverId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
    term.open(container);
    try { fit.fit(); } catch { /* container may be 0-size briefly */ }

    const ws = new WebSocket(getTerminalWebSocketURL(serverId, sessionId));
    const send = (msg: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    // The server defers its buffer replay until the FIRST resize, so that first
    // resize must carry the real container-fitted size — not xterm's 80x24
    // default. On (re)mount (e.g. switching terminal tabs) the container is
    // often 0x0 for a frame; sending 80x24 then makes Claude Code's full-screen
    // TUI replay at the wrong width and render jumbled. So we hold the initial
    // resize until the container has been measured at a non-zero size.
    let wsOpen = false;
    let sentInitial = false;
    const hasSize = () => {
      const el = containerRef.current;
      return !!el && el.clientWidth > 0 && el.clientHeight > 0;
    };
    const trySendInitial = () => {
      if (sentInitial || !wsOpen || !hasSize()) return;
      try { fit.fit(); } catch { return; }
      if (term.cols > 0 && term.rows > 0) {
        send({ type: 'resize', cols: term.cols, rows: term.rows, isInitial: true });
        sentInitial = true;
      }
    };

    ws.onopen = () => {
      wsOpen = true;
      trySendInitial();
    };
    ws.onerror = (e) => {
      console.error('[TerminalPane] WS error', sessionId, e);
    };
    ws.onclose = (e) => {
      // Keep only the close-with-error log; clean close is too noisy.
      if (!e.wasClean) console.warn('[TerminalPane] WS unclean close', sessionId, { code: e.code, reason: e.reason });
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
        if (msg.type === 'output') term.write(msg.data);
        else if (msg.type === 'exit') term.write(`\r\n\x1b[90m[process exited: ${msg.code}]\x1b[0m\r\n`);
        else if (msg.type === 'error') term.write(`\r\n\x1b[31m[error: ${msg.message}]\x1b[0m\r\n`);
      } catch { /* ignore non-JSON frames */ }
    };

    const onData = term.onData((data) => send({ type: 'input', data }));

    const doFit = () => {
      // Skip while hidden/zero-sized (e.g. a tab being torn down) — fitting at
      // 0x0 clamps the terminal to a tiny size and would resize the backing
      // tmux pane, corrupting the TUI.
      if (!hasSize()) return;
      if (!sentInitial) { trySendInitial(); return; }
      try {
        fit.fit();
        send({ type: 'resize', cols: term.cols, rows: term.rows });
      } catch { /* ignore */ }
    };
    const observer = new ResizeObserver(doFit);
    observer.observe(container);

    return () => {
      observer.disconnect();
      onData.dispose();
      try { ws.close(); } catch { /* ignore */ }
      term.dispose();
    };
  }, [sessionId, serverId]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
