/** True when `address` is an IPv4/IPv6 loopback peer (the desktop UI, the local
 *  MCP transport, health probes — all connect over loopback). Covers `127.0.0.0/8`,
 *  IPv6 `::1`, and the IPv4-mapped-IPv6 form Bun reports on dual-stack listeners
 *  (`::ffff:127.0.0.1`). An `undefined` address (couldn't resolve the peer) is
 *  treated as NON-loopback — fail safe: require the token rather than exempt. */
import { getAuthToken } from './services/config-file.ts';

export function isLoopbackPeer(address: string | undefined | null): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  return (
    a === '::1' ||
    a.startsWith('127.') ||
    a === '::ffff:127.0.0.1' ||
    a.startsWith('::ffff:127.')
  );
}

/** True when `address` is a loopback OR a private/local-network peer — the set of
 *  addresses that can legitimately reach a LAN-scoped (0.0.0.0 / tailnet) bind:
 *  RFC1918 IPv4 (10/8, 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10),
 *  IPv6 unique-local (fc00::/7), plus the IPv4-mapped-IPv6 forms Bun reports on a
 *  dual-stack listener (`::ffff:10.x` …). A null/unresolved address is NOT private
 *  (fail safe → treated as a remote/public peer). */
export function isPrivatePeer(address: string | undefined | null): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  if (isLoopbackPeer(a)) return true;
  // Strip an IPv4-mapped-IPv6 prefix so `::ffff:192.168.1.1` classifies as its IPv4.
  const v4 = a.startsWith('::ffff:') ? a.slice('::ffff:'.length) : a;
  // RFC1918 + link-local IPv4
  if (v4.startsWith('10.')) return true;
  if (v4.startsWith('192.168.')) return true;
  if (v4.startsWith('169.254.')) return true; // link-local
  // 172.16.0.0 – 172.31.255.255
  const m = v4.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 link-local fe80::/10  and unique-local fc00::/7 (fc.. / fd..)
  if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return true;
  if (a.startsWith('fc') || a.startsWith('fd')) return true;
  return false;
}

/**
 * Token gate for all HTTP/WS endpoints. Reads MERMAID_AUTH_TOKEN at call-time
 * (so it reflects the live env and is unit-testable without module resets).
 * Returns a 401 Response when a token is configured and the request neither
 * comes from a loopback peer NOR carries a matching `Authorization: Bearer
 * <token>`. Returns null to allow the request through.
 *
 * LOOPBACK EXEMPTION (mobile-app v1): when the sidecar is bound beyond loopback
 * (MERMAID_BIND_HOST=0.0.0.0 / a tailnet IP) so the phone can reach it, the
 * desktop UI + local MCP keep working TOKENLESS because they connect over
 * loopback; only non-loopback peers (the phone, over Tailscale) must present the
 * token. `peerAddress` is the connection's remote IP (Bun `server.requestIP`);
 * an unresolved peer is treated as remote (fail safe — require the token).
 *
 * Applied at the TOP of the server's `fetch`, BEFORE the WebSocket upgrade and
 * every route, so HTTP and the `/ws` + `/terminal/*` upgrades are gated
 * uniformly (no upgrade-bypass). `/api/health` and `/mcp*` are exempt (health is
 * probed by the switcher; MCP auth is a separate concern).
 *
 * Lives in its own module so it can be imported by tests without pulling in
 * the full server (which runs Bun.serve and the jsdom renderer at import time).
 */
export function checkAuth(req: Request, url: URL, peerAddress?: string | null): Response | null {
  const token = getAuthToken();
  if (!token) return null; // auth disabled — today's open-localhost behavior
  if (url.pathname === '/api/health' || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return null;
  if (isLoopbackPeer(peerAddress)) return null; // desktop UI / local MCP — tokenless
  // LAN-only enforcement: a peer that is neither loopback nor private-LAN can never
  // legitimately reach even a 0.0.0.0-bound sidecar — reject outright, before the
  // token gate, so a leaked token cannot admit a public/routable peer.
  if (!isPrivatePeer(peerAddress)) return new Response('Forbidden', { status: 403 });
  const header = req.headers.get('authorization');
  if (header === `Bearer ${token}`) return null;
  return new Response('Unauthorized', { status: 401 });
}
