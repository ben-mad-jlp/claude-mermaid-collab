/**
 * Phone pairing seam (design: zen-phone-pairing-design).
 *
 * Hands the bearer token to the user's own iPhone so the native Zen app can
 * authenticate over Tailscale. SECURITY: these routes RETURN the root secret, so
 * they are LOOPBACK-ONLY — the handler's first act is a non-loopback 403, BEFORE
 * any token generation or readout. This closes the bootstrap hole: with no token
 * configured `checkAuth` allows all peers, so without this guard a remote tailnet
 * peer could hit GET /api/pair, trigger token generation, and receive it.
 *
 * Token auto-provisioning (generate + persist when none exists) therefore only
 * ever happens for a loopback caller (the desktop UI's "Phone access" panel).
 */

import { networkInterfaces } from 'node:os';
import { isLoopbackPeer } from '../auth.ts';
import { getAuthToken, generateAuthToken, setAuthToken } from '../services/config-file.ts';
import { config } from '../config.ts';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

interface HostCandidate {
  address: string;
  iface: string;
  /** True for the 100.64.0.0/10 CGNAT range Tailscale assigns — a HINT, not a guarantee. */
  likelyTailscale: boolean;
}

/** Non-loopback IPv4 addresses, Tailscale-CGNAT candidates first. */
export function discoverHosts(): HostCandidate[] {
  const out: HostCandidate[] = [];
  const ifaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ address: a.address, iface: name, likelyTailscale: isCgnat(a.address) });
    }
  }
  // Tailscale candidates first (most likely the reachable address for the phone).
  return out.sort((x, y) => Number(y.likelyTailscale) - Number(x.likelyTailscale));
}

/** True for 100.64.0.0/10 (the CGNAT range Tailscale draws tailnet IPs from). */
function isCgnat(ip: string): boolean {
  const m = ip.split('.');
  if (m.length !== 4) return false;
  const a = Number(m[0]), b = Number(m[1]);
  return a === 100 && b >= 64 && b <= 127;
}

/** True when the server is bound to loopback only (the phone can't reach it). */
function boundToLoopback(): boolean {
  return isLoopbackPeer(config.HOST) || config.HOST === 'localhost';
}

/** Build the pairing payload (token + reachable hosts + QR deep link). */
function pairingPayload(): {
  token: string;
  port: number;
  bound: string;
  hosts: HostCandidate[];
  qr: string | null;
  warning?: string;
} {
  // Ensure a token exists (auto-provision on first pair — loopback caller only).
  let token = getAuthToken();
  if (!token) {
    token = generateAuthToken();
    setAuthToken(token);
  }
  const port = config.PORT;
  const hosts = discoverHosts();
  const best = hosts[0]?.address;
  const qr = best ? `mermaidcollab://pair?host=${best}:${port}&token=${token}` : null;
  const warning = boundToLoopback()
    ? `Server is bound to ${config.HOST} (loopback) — your phone can't reach it. Relaunch with MERMAID_BIND_HOST=0.0.0.0 (or the tailnet IP) so the phone can connect.`
    : hosts.length === 0
      ? 'No non-loopback network interface found — connect to a network (e.g. Tailscale) so the phone has a route.'
      : undefined;
  return { token, port, bound: config.HOST, hosts, qr, warning };
}

/**
 * Routes:
 *   GET  /api/pair          → pairing payload (auto-provisions a token if none)
 *   POST /api/pair/rotate   → rotate the token, return the fresh pairing payload
 *   GET  /api/auth/check    → gated liveness probe; 200 here means the token is
 *                             still valid (it reached the handler past checkAuth).
 *                             The iOS app pings it on launch + WS reconnect; a 401
 *                             (from checkAuth, when the token is stale) drives re-pair.
 * Returns null when the path isn't ours (so the server falls through to other routes).
 */
export function handlePairRoutes(req: Request, url: URL, peerAddress?: string | null): Response | null {
  // /api/auth/check is gated by checkAuth (NOT loopback-only) — reaching here means
  // the caller already presented a valid token (or is loopback). Just confirm.
  if (url.pathname === '/api/auth/check' && req.method === 'GET') {
    return Response.json({ ok: true });
  }

  if (url.pathname === '/api/pair' || url.pathname === '/api/pair/rotate') {
    // LOOPBACK-ONLY — 403 FIRST, before any token generation/readout. This is the
    // defense-in-depth that closes the no-token bootstrap hole (see file header).
    if (!isLoopbackPeer(peerAddress)) {
      return jsonError('Pairing is only available from the local machine (loopback).', 403);
    }
    if (url.pathname === '/api/pair' && req.method === 'GET') {
      return Response.json(pairingPayload());
    }
    if (url.pathname === '/api/pair/rotate' && req.method === 'POST') {
      setAuthToken(generateAuthToken());
      return Response.json(pairingPayload());
    }
    return jsonError('Method not allowed', 405);
  }

  return null;
}
