import { checkAuth } from '../auth.js';
import { isAllowedOrigin } from '../services/origin-guard.ts';
import { handleArtifactInboxAPI } from './artifact-inbox-api.js';
import { handleTurnOutlinesAPI } from './turn-outlines-api.js';

/**
 * Auth gate, cross-origin guard, and API delegations combined into
 * a single early checkpoint before the WebSocket upgrade and other routes.
 *
 * Runs consecutive checks in order:
 * 1. checkAuth: loopback + private-peer + bearer-token gate
 * 2. isAllowedOrigin: cross-origin drive-by guard for browsers
 * 3. handleArtifactInboxAPI: artifact-inbox prefix delegation
 * 4. handleTurnOutlinesAPI: turn-outlines prefix delegation
 *
 * Returns a Response if any check denies or matches; returns null to continue
 * to the next route handler in the chain.
 */
export async function dispatchRequest(
  req: Request,
  url: URL,
  peerAddress?: string | null
): Promise<Response | null> {
  // Auth gate — precedes WS upgrades, /mcp, and all /api routes. The peer IP
  // drives the loopback exemption: the desktop UI + local MCP (loopback) stay
  // tokenless; a non-loopback peer (the phone over Tailscale) must present the
  // token once MERMAID_AUTH_TOKEN is set and the server is bound beyond loopback.
  const denied = checkAuth(req, url, peerAddress);
  if (denied) return denied;

  // Cross-origin drive-by guard — a browser page on a foreign origin must not
  // drive this API/WS once the port is LAN-reachable. Native clients send no
  // Origin and pass; same-origin (desktop UI) passes; a foreign Origin is 403'd
  // BEFORE any WS upgrade or /api route. Health + /mcp* stay exempt (parity).
  if (!isAllowedOrigin(req, url)) return new Response('Forbidden', { status: 403 });

  // Artifact-inbox delegation — routed through the gated path to ensure only
  // authenticated/private peers can post envelopes.
  if (url.pathname.startsWith('/api/artifact-inbox')) {
    const res = await handleArtifactInboxAPI(req, url);
    if (res) return res;
  }

  // Turn-outlines delegation — routed through the gated path to ensure only
  // authenticated/private peers can read/write turn outline snapshots.
  if (url.pathname.startsWith('/api/turn-outlines')) {
    const res = await handleTurnOutlinesAPI(req, url);
    if (res) return res;
  }

  return null;
}
