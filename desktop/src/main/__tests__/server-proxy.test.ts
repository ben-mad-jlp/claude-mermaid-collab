import { describe, it, expect, afterEach } from 'vitest';
import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { ServerProxy, type Upstream } from '../server-proxy';

// A fake "remote" collab server that accepts terminal-attach WS connections.
// It records every upstream connection it accepts (the expensive cross-host
// attach we want to keep warm) and how many of those it has seen close.
function makeFakeUpstream() {
  let accepted = 0;
  let closed = 0;
  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws) => {
    accepted += 1;
    sockets.add(ws);
    // Echo so a client round-trip can confirm the bridge is live.
    ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary }));
    ws.on('close', () => { closed += 1; sockets.delete(ws); });
  });
  return {
    wss,
    get accepted() { return accepted; },
    get closed() { return closed; },
    get open() { return sockets.size; },
    port: () => (wss.address() as AddressInfo).port,
    async ready() {
      await new Promise<void>((r) => wss.once('listening', r));
    },
    async stop() {
      for (const s of sockets) try { s.terminate(); } catch { /* ignore */ }
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}

function openClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', () => resolve());
    ws.close();
  });
}

const tick = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));

describe('ServerProxy per-server warm attach', () => {
  let proxy: ServerProxy | null = null;
  let upstream: ReturnType<typeof makeFakeUpstream> | null = null;

  afterEach(async () => {
    if (proxy) { await proxy.stop(); proxy = null; }
    if (upstream) { await upstream.stop(); upstream = null; }
  });

  async function setup(): Promise<{ proxyPort: number }> {
    upstream = makeFakeUpstream();
    await upstream.ready();
    const target: Upstream = { host: '127.0.0.1', port: upstream.port() };
    // localUpstream is unused for /_per-server routes; resolver supplies targets.
    proxy = new ServerProxy({ host: '127.0.0.1', port: 1 });
    proxy.setResolver((id) => (id === 'srv1' ? target : null));
    const { port } = await proxy.start();
    return { proxyPort: port };
  }

  it('reuses the warm upstream attach when a client reconnects to the same pty', async () => {
    const { proxyPort } = await setup();
    const url = `ws://127.0.0.1:${proxyPort}/_per-server/srv1/terminal/pty1`;

    const c1 = await openClient(url);
    await tick();
    expect(upstream!.accepted).toBe(1);
    expect(upstream!.open).toBe(1);

    // Switch away: the renderer closes. Upstream must stay WARM (not closed).
    await closeClient(c1);
    await tick();
    expect(upstream!.open).toBe(1);
    expect(upstream!.closed).toBe(0);

    // Switch back: reconnect reuses the live attach — no new upstream accept.
    const c2 = await openClient(url);
    await tick();
    expect(upstream!.accepted).toBe(1); // still 1: warm hit, no cold re-attach
    expect(upstream!.open).toBe(1);

    await closeClient(c2);
  });

  it('cold-attaches a distinct pty (different warm key)', async () => {
    const { proxyPort } = await setup();
    const c1 = await openClient(`ws://127.0.0.1:${proxyPort}/_per-server/srv1/terminal/ptyA`);
    await tick();
    const c2 = await openClient(`ws://127.0.0.1:${proxyPort}/_per-server/srv1/terminal/ptyB`);
    await tick();
    expect(upstream!.accepted).toBe(2);
    await closeClient(c1);
    await closeClient(c2);
  });

  it('bounds the warm set with LRU eviction', async () => {
    const { proxyPort } = await setup();
    const MAX_WARM = 6; // mirrors ServerProxy.MAX_WARM
    const N = MAX_WARM + 2;

    // Open then park (close) N distinct ptys, oldest first.
    for (let i = 0; i < N; i++) {
      const c = await openClient(`ws://127.0.0.1:${proxyPort}/_per-server/srv1/terminal/pty${i}`);
      await tick(10);
      await closeClient(c);
      await tick(10);
    }
    await tick();

    // All N attached at some point; only MAX_WARM may stay warm — the rest are
    // evicted (their upstream sockets closed).
    expect(upstream!.accepted).toBe(N);
    expect(upstream!.open).toBeLessThanOrEqual(MAX_WARM);
    expect(upstream!.closed).toBe(N - MAX_WARM);
  });

  it('flushes upstream output buffered while detached on reconnect', async () => {
    const { proxyPort } = await setup();
    const url = `ws://127.0.0.1:${proxyPort}/_per-server/srv1/terminal/pty1`;

    const c1 = await openClient(url);
    await tick();
    await closeClient(c1);
    await tick();

    // While warm/detached, push output from the upstream side.
    for (const s of upstream!.wss.clients) s.send('warm-output');
    await tick();

    // Reconnect and confirm the buffered frame is delivered. Attach the message
    // listener at construction (before 'open') — the warm flush fires during the
    // upgrade, and a browser likewise has onmessage set before any frame lands.
    const c2 = new WebSocket(url);
    const got = await new Promise<string>((resolve, reject) => {
      c2.on('message', (d) => resolve(d.toString()));
      c2.once('error', reject);
    });
    expect(got).toBe('warm-output');
    await closeClient(c2);
  });

  it('tears down warm upstreams on stop()', async () => {
    const { proxyPort } = await setup();
    const c1 = await openClient(`ws://127.0.0.1:${proxyPort}/_per-server/srv1/terminal/pty1`);
    await tick();
    await closeClient(c1);
    await tick();
    expect(upstream!.open).toBe(1);

    await proxy!.stop();
    proxy = null;
    await tick();
    expect(upstream!.open).toBe(0);
  });
});
