/** Browser cross-origin drive-by guard. Native clients (iOS, curl, MCP) send NO
 *  Origin header → always allowed. A browser page sends Origin; if it matches the
 *  request Host it is same-origin → allowed; a foreign Origin → rejected.
 *  `/api/health` and `/mcp*` are exempt (parity with checkAuth). Returns true =
 *  allow, false = reject (caller returns 403). */
export function isAllowedOrigin(req: Request, url: URL): boolean {
  // Exemptions — parity with checkAuth (health probe + MCP transport).
  if (url.pathname === '/api/health' || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return true;

  const origin = req.headers.get('origin');
  if (!origin) return true; // native client / curl / MCP — no Origin header

  let originHost: string;
  let originHostname: string;
  try {
    const o = new URL(origin);
    originHost = o.host;            // host:port
    originHostname = o.hostname;    // host only
  } catch {
    return false; // malformed Origin — reject
  }

  // Same-origin: Origin host (host:port) equals the request Host header.
  const host = req.headers.get('host');
  if (host && originHost === host) return true;

  // Loopback dev origins (localhost / 127.* / ::1) are same-machine — allow so the
  // desktop UI keeps working regardless of the exact Host spelling.
  const hn = originHostname.toLowerCase();
  if (hn === 'localhost' || hn === '::1' || hn.startsWith('127.')) return true;

  return false; // present AND foreign → reject
}
