import { readFile } from 'node:fs/promises';
import type { WebSocketHandler } from '../websocket/handler.ts';
import { ideState } from '../services/ide-state.ts';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function handleIdeRoutes(req: Request, url: URL, wsHandler: WebSocketHandler): Promise<Response | null> {
  if (url.pathname === '/api/ide/status' && req.method === 'GET') {
    return Response.json(ideState.getStatus());
  }

  if (url.pathname === '/api/ide/focus-terminal' && req.method === 'POST') {
    try {
      const { claudeSessionId } = await req.json() as { claudeSessionId?: string };
      if (!claudeSessionId || !UUID_RE.test(claudeSessionId)) {
        return jsonError('claudeSessionId must be a valid UUID', 400);
      }

      const bindingPath = `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`;
      let bindingRaw: string;
      try {
        bindingRaw = await readFile(bindingPath, 'utf-8');
      } catch (err: any) {
        if (err?.code === 'ENOENT') return jsonError('Session not registered or binding missing', 404);
        return jsonError(`Failed to read binding: ${err?.message || String(err)}`, 500);
      }

      let binding: { claudePid?: string | number; project?: string; session?: string };
      try {
        binding = JSON.parse(bindingRaw);
      } catch {
        return jsonError('Corrupt binding file', 500);
      }

      if (!binding.claudePid) return jsonError('claudePid not available for this session', 404);

      wsHandler.broadcastToChannel('ide', {
        type: 'ide_focus_terminal',
        claudePid: Number(binding.claudePid),
        claudeSessionId,
        project: binding.project ?? '',
        session: binding.session ?? '',
      });

      return Response.json({ success: true });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/ide/create-terminal' && req.method === 'POST') {
    try {
      const { session } = await req.json() as { session?: string };
      if (!session || typeof session !== 'string') {
        return jsonError('session is required', 400);
      }
      const proc = Bun.spawn(
        ['tmux', 'new-session', '-d', '-s', session],
        { stdout: 'ignore', stderr: 'ignore' }
      );
      await proc.exited; // ok if it fails (session already exists)
      wsHandler.broadcastToChannel('ide', {
        type: 'ide_open_terminal',
        session,
      });
      return Response.json({ success: true });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
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

  if (url.pathname === '/api/ide/tmux-sessions' && req.method === 'GET') {
    try {
      const proc = Bun.spawn(['tmux', 'ls', '-F', '#{session_name}'], { stdout: 'pipe', stderr: 'ignore' });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      const sessions = stdout.trim().split('\n').filter(Boolean);
      return Response.json({ sessions });
    } catch {
      return Response.json({ sessions: [] });
    }
  }

  return null;
}
