/**
 * [P3] Heartbeat + state machine + jitter reconnect + PTY idle lease
 * (design §3B + §3C, assertions #4/#5/#6).
 *
 * Real `ws` servers + SHORT injected intervals (heartbeat/pong-grace/idle-lease)
 * with real timers — the production code reads these from constructor opts, so a
 * test drives the same logic sub-second without faking the socket layer.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { WatchAggregator } from '../watch-aggregator';
import { ServerProxy, type Upstream } from '../server-proxy';

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A fake collab /ws upstream. `autoPong:false` lets a test stall heartbeat
 *  pongs to exercise the degrade→dead path. */
function makeWsServer(opts: { autoPong?: boolean } = {}) {
  let accepted = 0;
  let closed = 0;
  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', autoPong: opts.autoPong ?? true });
  wss.on('connection', (ws) => {
    accepted += 1;
    sockets.add(ws);
    ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary })); // echo
    ws.on('close', () => { closed += 1; sockets.delete(ws); });
  });
  return {
    wss,
    get accepted() { return accepted; },
    get closed() { return closed; },
    get open() { return sockets.size; },
    port: () => (wss.address() as AddressInfo).port,
    dropAll() { for (const s of sockets) try { s.close(); } catch { /* ignore */ } },
    ready: () => new Promise<void>((r) => wss.once('listening', r)),
    stop: () => new Promise<void>((r) => { for (const s of sockets) try { s.terminate(); } catch { /* ignore */ } wss.close(() => r()); }),
  };
}

function openClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// ── Assertion #4 — heartbeat state machine + jittered reconnect ──────────────

describe('[P3] WatchAggregator heartbeat + jitter reconnect (assertion #4)', () => {
  let agg: WatchAggregator | null = null;
  let server: ReturnType<typeof makeWsServer> | null = null;
  afterEach(async () => { agg?.stop(); agg = null; if (server) { await server.stop(); server = null; } });

  it('a dropped upstream → dead, then jittered backoff reconnect re-opens (attempt resets, state live)', async () => {
    server = makeWsServer();
    await server.ready();
    let opens = 0;
    // rng=0 → full-jitter delay floors to ~0ms, so the reconnect is near-immediate
    // (a non-jittered 2^0·1000ms backoff could never re-open inside the window below).
    agg = new WatchAggregator(() => {}, () => { opens += 1; }, { heartbeatMs: 10_000, pongGraceMs: 10_000, rng: () => 0 });
    agg.setWatched([{ id: 'srv1', host: '127.0.0.1', port: server.port() }]);

    await tick(120);
    expect(opens).toBe(1);
    expect(agg.connectionState('srv1')).toBe('live');

    // Drop the connection from the server side → client 'close' → dead → reconnect.
    server.dropAll();
    await tick(200);
    expect(opens).toBeGreaterThanOrEqual(2);          // jittered reconnect fired
    expect(agg.connectionState('srv1')).toBe('live'); // recovered
  });

  it('stalled pongs degrade then kill the socket, and it recovers (terminate→reconnect)', async () => {
    server = makeWsServer({ autoPong: false }); // never answers heartbeat pings
    await server.ready();
    let opens = 0;
    // rng=0.15 → ~150ms post-death backoff, so the 'dead' window is long enough to
    // sample, yet short enough that the reconnect (recovery) also fires in-window.
    agg = new WatchAggregator(() => {}, () => { opens += 1; }, { heartbeatMs: 50, pongGraceMs: 20, rng: () => 0.15 });
    agg.setWatched([{ id: 'srv1', host: '127.0.0.1', port: server.port() }]);

    const seen = new Set<string>();
    for (let i = 0; i < 45; i++) { const s = agg.connectionState('srv1'); if (s) seen.add(s); await tick(10); }

    expect(seen.has('degraded')).toBe(true); // first missed pong
    expect(seen.has('dead')).toBe(true);     // second miss → terminate
    expect(opens).toBeGreaterThanOrEqual(2); // terminate → reconnect cycle recovered
  });
});

// ── Assertion #5 — remote terminal I/O round-trip + detach→warm reuse ────────

describe('[P3] ServerProxy remote I/O round-trip + warm reuse (assertion #5)', () => {
  let proxy: ServerProxy | null = null;
  let upstream: ReturnType<typeof makeWsServer> | null = null;
  afterEach(async () => { if (proxy) { await proxy.stop(); proxy = null; } if (upstream) { await upstream.stop(); upstream = null; } });

  async function setup(opts?: { idleLeaseMs?: number }) {
    upstream = makeWsServer();
    await upstream.ready();
    const target: Upstream = { host: '127.0.0.1', port: upstream.port() };
    proxy = new ServerProxy({ host: '127.0.0.1', port: 1 }, { heartbeatMs: 10_000, pongGraceMs: 10_000, ...opts });
    proxy.setResolver((id) => (id === 'srv1' ? target : null));
    const { port } = await proxy.start();
    return port;
  }

  it('round-trips I/O over the real hop and reuses the warm upstream on reconnect', async () => {
    const port = await setup();
    const url = `ws://127.0.0.1:${port}/_per-server/srv1/terminal/pty1`;

    const c1 = await openClient(url);
    const echoed = await new Promise<string>((resolve) => {
      c1.on('message', (d) => resolve(d.toString()));
      c1.send('hello-pty');
    });
    expect(echoed).toBe('hello-pty');       // I/O round-trip over browser↔proxy↔upstream
    expect(upstream!.accepted).toBe(1);

    // Switch away — upstream parked WARM, not torn down.
    c1.close();
    await tick(50);
    expect(upstream!.open).toBe(1);
    expect(upstream!.closed).toBe(0);

    // Switch back — reuse the warm attach, no new cross-host accept.
    const c2 = await openClient(url);
    await tick(50);
    expect(upstream!.accepted).toBe(1);     // warm hit
    c2.close();
  });
});

// ── Assertion #6 — PTY idle lease reaps an abandoned warm attach ─────────────

describe('[P3] ServerProxy PTY idle lease (assertion #6)', () => {
  let proxy: ServerProxy | null = null;
  let upstream: ReturnType<typeof makeWsServer> | null = null;
  afterEach(async () => { if (proxy) { await proxy.stop(); proxy = null; } if (upstream) { await upstream.stop(); upstream = null; } });

  it('a warm attach left idle past the lease is disposed and its upstream closed', async () => {
    upstream = makeWsServer();
    await upstream.ready();
    const target: Upstream = { host: '127.0.0.1', port: upstream.port() };
    proxy = new ServerProxy({ host: '127.0.0.1', port: 1 }, { heartbeatMs: 10_000, pongGraceMs: 10_000, idleLeaseMs: 80 });
    proxy.setResolver((id) => (id === 'srv1' ? target : null));
    const { port } = await proxy.start();
    const url = `ws://127.0.0.1:${port}/_per-server/srv1/terminal/pty1`;

    const c1 = await openClient(url);
    await tick(20);
    expect(upstream.open).toBe(1);
    expect(proxy.connState('srv1\n/terminal/pty1')).toBe('live');

    // Park warm, then leave it idle PAST the lease (80ms) without reattaching.
    c1.close();
    await tick(40); // still within the lease — upstream stays warm
    expect(upstream.open).toBe(1);
    await tick(120); // now past the lease → disposeConn runs

    expect(upstream.open).toBe(0);          // upstream WS closed → server reaps the attach
    expect(upstream.closed).toBe(1);
    expect(proxy.connState('srv1\n/terminal/pty1')).toBeUndefined(); // gone
  });
});
