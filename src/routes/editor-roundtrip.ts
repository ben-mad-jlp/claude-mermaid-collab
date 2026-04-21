import { stat } from 'node:fs/promises';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const writtenAtMap = new Map<string, number>();

export async function handleEditorRoundtrip(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/agent/editor-open' && req.method === 'POST') {
    try {
      const body = await req.json() as { editorStateJson: string; sessionId: string };
      const { editorStateJson, sessionId: _sessionId } = body;
      const token = crypto.randomUUID();
      const path = `/tmp/claude-editor-${token}.json`;
      await Bun.write(path, editorStateJson);
      const writtenAt = Date.now();
      writtenAtMap.set(token, writtenAt);
      setTimeout(async () => {
        writtenAtMap.delete(token);
        try {
          const { unlink } = await import('node:fs/promises');
          await unlink(path);
        } catch { /* already gone */ }
      }, 300_000);
      return new Response(JSON.stringify({ token, path }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('[Editor Roundtrip] editor-open error:', err);
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  if (url.pathname === '/api/agent/editor-poll' && req.method === 'GET') {
    try {
      const token = url.searchParams.get('token');
      if (!token) return jsonError('Missing required query parameter: token', 400);
      const writtenAt = writtenAtMap.get(token);
      if (writtenAt === undefined) return jsonError('Not found', 404);
      const path = `/tmp/claude-editor-${token}.json`;
      let iterations = 0;
      while (iterations < 60) {
        try {
          const fileStat = await stat(path);
          if (fileStat.mtimeMs > writtenAt) {
            const content = await Bun.file(path).text();
            return new Response(JSON.stringify({ content }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch {}
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        iterations++;
      }
      return new Response(JSON.stringify({ timeout: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('[Editor Roundtrip] editor-poll error:', err);
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  return null;
}
