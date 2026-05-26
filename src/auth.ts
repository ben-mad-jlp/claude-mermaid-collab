/**
 * Token gate for all HTTP/WS endpoints. Reads MERMAID_AUTH_TOKEN at call-time
 * (so it reflects the live env and is unit-testable without module resets).
 * Returns a 401 Response when a token is configured and the request lacks a
 * matching `Authorization: Bearer <token>`. `/api/health` and `/mcp*` are
 * exempt (health is probed by the switcher; MCP auth is a separate concern).
 * Returns null to allow the request through.
 *
 * Lives in its own module so it can be imported by tests without pulling in
 * the full server (which runs Bun.serve and the jsdom renderer at import time).
 */
export function checkAuth(req: Request, url: URL): Response | null {
  const token = process.env.MERMAID_AUTH_TOKEN ?? '';
  if (!token) return null; // auth disabled — today's open-localhost behavior
  if (url.pathname === '/api/health' || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return null;
  const header = req.headers.get('authorization');
  if (header === `Bearer ${token}`) return null;
  return new Response('Unauthorized', { status: 401 });
}
