import { randomUUID } from 'node:crypto';
import { ideState } from '../services/ide-state.ts';

function sendToIdeOrError(msg: Record<string, unknown>): Response | null {
  if (!ideState.sendToIde(msg)) return jsonError('VS Code not connected', 503);
  return null;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleBrowserRoutes(req: Request, url: URL): Promise<Response | null> {
  // POST /api/browser/open { url } → { sessionId }
  if (url.pathname === '/api/browser/open' && req.method === 'POST') {
    let body: { url?: string };
    try { body = await req.json() as { url?: string }; } catch { return jsonError('Invalid JSON', 400); }
    if (!body.url) return jsonError('url is required', 400);
    if (!ideState.getStatus().connected) return jsonError('VS Code not connected', 503);

    const requestId = randomUUID();
    const pending = ideState.waitForBrowserResponse<{ sessionId: string }>(requestId, 60_000);
    const err1 = sendToIdeOrError({ type: 'browser_open', requestId, url: body.url });
    if (err1) return err1;
    try {
      const result = await pending;
      return Response.json(result);
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : String(err), 504);
    }
  }

  // POST /api/browser/command { sessionId, method, params? } → { result }
  if (url.pathname === '/api/browser/command' && req.method === 'POST') {
    let body: { sessionId?: string; method?: string; params?: unknown };
    try { body = await req.json() as typeof body; } catch { return jsonError('Invalid JSON', 400); }
    if (!body.sessionId || !body.method) return jsonError('sessionId and method are required', 400);

    const requestId = randomUUID();
    const pending = ideState.waitForBrowserResponse(requestId, 15_000);
    const err2 = sendToIdeOrError({
      type: 'browser_command', requestId,
      sessionId: body.sessionId, method: body.method, params: body.params,
    });
    if (err2) return err2;
    try {
      const result = await pending;
      return Response.json({ result });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : String(err), 504);
    }
  }

  // GET /api/browser/events?sessionId=&type=console|network → { events }
  if (url.pathname === '/api/browser/events' && req.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    const eventType = url.searchParams.get('type') ?? 'console';
    if (!sessionId) return jsonError('sessionId is required', 400);

    const requestId = randomUUID();
    const pending = ideState.waitForBrowserResponse(requestId, 5_000);
    const err3 = sendToIdeOrError({ type: 'browser_events', requestId, sessionId, eventType });
    if (err3) return err3;
    try {
      const result = await pending;
      return Response.json({ events: result });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : String(err), 504);
    }
  }

  // POST /api/browser/close { sessionId }
  if (url.pathname === '/api/browser/close' && req.method === 'POST') {
    let body: { sessionId?: string };
    try { body = await req.json() as { sessionId?: string }; } catch { return jsonError('Invalid JSON', 400); }
    if (!body.sessionId) return jsonError('sessionId is required', 400);
    ideState.sendToIde({ type: 'browser_close', sessionId: body.sessionId });
    return Response.json({ success: true });
  }

  return null;
}
