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
      convertEol: true,
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

    ws.onopen = () => {
      send({ type: 'resize', cols: term.cols, rows: term.rows, isInitial: true });
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
