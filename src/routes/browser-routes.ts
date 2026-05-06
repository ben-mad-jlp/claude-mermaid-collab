import { ensureTab, focusTab, listActiveSessions, CDP_PORT } from '../services/cdp-session.js';
import type { WebSocketHandler } from '../websocket/handler.js';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleBrowserRoutes(req: Request, url: URL, wsHandler: WebSocketHandler): Promise<Response | null> {
  // GET /api/browser/sessions → { sessions }
  if (url.pathname === '/api/browser/sessions' && req.method === 'GET') {
    return Response.json({ sessions: listActiveSessions() });
  }

  // POST /api/browser/create-tab { session, port? }
  if (url.pathname === '/api/browser/create-tab' && req.method === 'POST') {
    let body: { session?: string; port?: number };
    try { body = await req.json() as typeof body; } catch { return jsonError('Invalid JSON', 400); }
    if (!body.session) return jsonError('session is required', 400);
    try {
      await ensureTab(body.session, body.port ?? CDP_PORT);
      wsHandler.broadcastBrowserTabUpdate(body.session, true);
      return Response.json({ success: true, session: body.session });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : String(err), 503);
    }
  }

  // POST /api/browser/focus-tab { session, port? }
  if (url.pathname === '/api/browser/focus-tab' && req.method === 'POST') {
    let body: { session?: string; port?: number };
    try { body = await req.json() as typeof body; } catch { return jsonError('Invalid JSON', 400); }
    if (!body.session) return jsonError('session is required', 400);
    try {
      await focusTab(body.session, body.port ?? CDP_PORT);
      return Response.json({ success: true });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : String(err), 503);
    }
  }

  return null;
}
