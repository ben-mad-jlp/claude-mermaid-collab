/** True when `address` is an IPv4/IPv6 loopback peer (the desktop UI, the local
 *  MCP transport, health probes — all connect over loopback). Covers `127.0.0.0/8`,
 *  IPv6 `::1`, and the IPv4-mapped-IPv6 form Bun reports on dual-stack listeners
 *  (`::ffff:127.0.0.1`). An `undefined` address (couldn't resolve the peer) is
 *  treated as NON-loopback — fail safe: require the token rather than exempt. */
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
  const token = process.env.MERMAID_AUTH_TOKEN ?? '';
  if (!token) return null; // auth disabled — today's open-localhost behavior
  if (url.pathname === '/api/health' || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return null;
  if (isLoopbackPeer(peerAddress)) return null; // desktop UI / local MCP — tokenless
  const header = req.headers.get('authorization');
  if (header === `Bearer ${token}`) return null;
  return new Response('Unauthorized', { status: 401 });
}
