/**
 * [P1] Regression lock for the peer_registry hardening (design §2 + §5).
 *
 * Two security properties, written as the failing assertions FIRST then made
 * green by deletion + one guard:
 *
 *   Assertion #1 — token never travels on a peer; a tokenless direct fetch to a
 *     token-enforcing server is 401, while legit REST (health, or an authorized
 *     call) still works. Direct peer calls degrade to desktop-brokered routing.
 *
 *   Assertion #2 — the peer_registry broadcast carries NO token field (it is
 *     structurally unrepresentable on PeerInfo / the WS schema), and a forged
 *     peer_registry frame from a NON-loopback remote is rejected (the SSRF the
 *     loopback gate closes even when MERMAID_AUTH_TOKEN is unset).
 *
 * Uses the two-server verification spine (`two-server-harness.ts`, [H0]).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSidecar, waitExit, type Sidecar } from './two-server-harness';
import { WebSocketHandler, isLoopbackAddress } from '../websocket/handler';
import { setPeerRegistry, listPeers, getPeer, type PeerInfo } from '../services/supervisor-store';

// ── Assertion #2 (unit) — no token on the wire + loopback-gated ingest ──────────

describe('[P1] peer_registry: no token field + loopback-gated ingest (assertion #2)', () => {
  beforeEach(() => setPeerRegistry([]));
  afterEach(() => setPeerRegistry([]));

  it('PeerInfo has no token field (structurally unrepresentable)', () => {
    const p: PeerInfo = { serverId: 's1', baseUrl: 'http://127.0.0.1:9' };
    // @ts-expect-error — a bearer token must NOT be representable on a peer (P1 §2).
    // If `token` is re-added to PeerInfo this directive goes unused and tsc fails,
    // catching any regression that puts a token back on the wire.
    void p.token;
    expect(Object.keys(p)).toEqual(['serverId', 'baseUrl']);
  });

  it('isLoopbackAddress accepts only IPv4/IPv6 loopback', () => {
    for (const ok of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(ok)).toBe(true);
    for (const bad of ['192.168.1.50', '10.0.0.2', '0.0.0.0', '', undefined, null]) {
      expect(isLoopbackAddress(bad)).toBe(false);
    }
  });

  /** A minimal fake of Bun's ServerWebSocket carrying a remoteAddress. */
  function fakeWs(remoteAddress: string) {
    return { data: { subscriptions: new Set<string>() }, remoteAddress, send: () => {} } as never;
  }

  const frame = JSON.stringify({
    type: 'peer_registry',
    peers: [{ serverId: 'srvX', baseUrl: 'http://127.0.0.1:1234' }],
  });

  it('ACCEPTS a peer_registry frame from a loopback remote', () => {
    const h = new WebSocketHandler();
    h.handleMessage(fakeWs('127.0.0.1'), frame);
    expect(getPeer('srvX')?.baseUrl).toBe('http://127.0.0.1:1234');
  });

  it('REJECTS a forged peer_registry frame from a non-loopback remote', () => {
    const h = new WebSocketHandler();
    h.handleMessage(fakeWs('192.168.1.50'), frame);
    expect(getPeer('srvX')).toBeUndefined();
    expect(listPeers()).toHaveLength(0);
  });
});

// ── Assertion #1 (integration) — tokenless direct fetch → 401, REST still works ──

describe('[P1] token gate: tokenless direct fetch is 401, REST works (assertion #1)', () => {
  let server: Sidecar | null = null;
  let tmpHome = '';
  const TOKEN = 'p1-secret-token';

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'mc-p1-'));
    server = await spawnSidecar({
      HOME: tmpHome,
      PORT: '0',
      MERMAID_PROJECT: `/tmp/p1-${Date.now()}`,
      MERMAID_SESSION: 'p1',
      MERMAID_AUTH_TOKEN: TOKEN,
    });
  }, 60_000);

  afterEach(async () => {
    if (server?.proc.exitCode === null) {
      try { server.proc.kill('SIGTERM'); } catch { /* ignore */ }
      await waitExit(server.proc);
    }
    server = null;
    if (tmpHome) { await rm(tmpHome, { recursive: true, force: true }); tmpHome = ''; }
  });

  it('health is exempt (REST reachable) but a tokenless protected fetch is 401', async () => {
    // /api/health is auth-exempt — cross-server REST/health probing still works.
    expect((await fetch(`${server!.baseUrl}/api/health`)).status).toBe(200);

    // A protected route WITHOUT the bearer (the forged/tokenless direct call a
    // peer would now make) is rejected.
    const tokenless = await fetch(`${server!.baseUrl}/api/supervisor/identity`);
    expect(tokenless.status).toBe(401);

    // The SAME route WITH the bearer works — authorized REST is unaffected.
    const authed = await fetch(`${server!.baseUrl}/api/supervisor/identity`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(authed.status).toBe(200);
  }, 30_000);
});
