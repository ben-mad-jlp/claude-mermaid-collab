import type { WebSocketHandler } from '../websocket/handler.ts';
import { ideState } from '../services/ide-state.ts';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleIdeRoutes(req: Request, url: URL, wsHandler: WebSocketHandler): Promise<Response | null> {
  if (url.pathname === '/api/ide/status' && req.method === 'GET') {
    return Response.json(ideState.getStatus());
  }

  if (url.pathname === '/api/ide/open-diff' && req.method === 'POST') {
    const timeoutPromise = new Promise<Response>(resolve =>
      setTimeout(() => resolve(Response.json({ error: 'IDE request timed out' }, { status: 504 })), 3000)
    );
    const handlerPromise = (async () => {
      try {
        const { filePath } = await req.json() as { filePath?: string };
        if (!filePath || !filePath.startsWith('/')) {
          return jsonError('filePath must be a non-empty absolute path', 400);
        }

        wsHandler.broadcastToChannel('ide', {
          type: 'ide_open_diff',
          filePath,
        });

        ideState.diffOpened(filePath);
        return Response.json({ success: true });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
      }
    })();
    return Promise.race([handlerPromise, timeoutPromise]);
  }

  return null;
}
