import {
  putTurnOutline,
  listTurnOutlines,
  countTurnOutlines,
  TURN_OUTLINE_RING_CAP,
} from '../services/turn-outlines-store.js';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleTurnOutlinesAPI(
  req: Request,
  url: URL
): Promise<Response | null> {
  if (url.pathname === '/api/turn-outlines' && req.method === 'POST') {
    let data: unknown;
    try {
      data = await req.json();
    } catch {
      return jsonError('invalid JSON', 400);
    }

    if (!data || typeof data !== 'object') {
      return jsonError('body must be a JSON object', 400);
    }

    const obj = data as Record<string, unknown>;

    if (typeof obj.project !== 'string' || obj.project.length === 0) {
      return jsonError('project must be a non-empty string', 400);
    }

    if (typeof obj.session !== 'string' || obj.session.length === 0) {
      return jsonError('session must be a non-empty string', 400);
    }

    if (obj.outline === undefined || obj.outline === null) {
      return jsonError('outline is required', 400);
    }

    const turn = typeof obj.turn === 'string' ? obj.turn : '';

    putTurnOutline({
      project: obj.project,
      session: obj.session,
      turn,
      outline: obj.outline,
    });

    const stored = countTurnOutlines(obj.project, obj.session);

    return Response.json(
      { ok: true, stored, cap: TURN_OUTLINE_RING_CAP },
      { status: 200 }
    );
  }

  if (url.pathname === '/api/turn-outlines' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    const session = url.searchParams.get('session');

    if (!project || project.length === 0) {
      return jsonError('project is required', 400);
    }

    if (!session || session.length === 0) {
      return jsonError('session is required', 400);
    }

    const outlines = listTurnOutlines(project, session);

    return Response.json(
      { outlines, cap: TURN_OUTLINE_RING_CAP },
      { status: 200 }
    );
  }

  if (url.pathname === '/api/turn-outlines') {
    return jsonError('method not allowed', 405);
  }

  return null;
}
