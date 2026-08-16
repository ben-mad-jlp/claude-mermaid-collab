// HTTP surface over the conductor: the read-only conductor_pass journal, plus the one-shot
// operator KICK that forces exactly one pass past the fingerprint debounce.
import { listConductorPassesPage } from '../services/conductor-pass-journal.js';
import { requestConductorKick } from '../services/conductor-kick.js';
import { nicknamesForProject } from '../services/nickname-lookup.js';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleConductorRoutes(req: Request, url: URL): Promise<Response | null> {
  // GET /api/conductor/journal?project=&missionId=&limit=&offset=
  if (url.pathname === '/api/conductor/journal' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    const missionId = url.searchParams.get('missionId') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam != null ? Number(limitParam) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 0)) {
      return jsonError('limit must be a non-negative number', 400);
    }
    const offsetParam = url.searchParams.get('offset');
    const offset = offsetParam != null ? Number(offsetParam) : undefined;
    if (offset !== undefined && (!Number.isFinite(offset) || offset < 0)) {
      return jsonError('offset must be a non-negative number', 400);
    }
    const { rows, total } = listConductorPassesPage(project, { missionId, limit, offset });
    const nicknames = nicknamesForProject(project);
    return Response.json({ project, rows, total, nicknames });
  }

  // POST /api/conductor/kick  { project, missionId? }
  //
  // Arms a ONE-SHOT kick: the next conductor pass for this project (or this mission) evaluates
  // even though the world fingerprint has not moved, and CONSUMES the flag on the way through.
  // Deliberately NOT idempotent-with-accumulation: two kicks before a pass runs still buy one
  // pass. This endpoint bypasses the fingerprint debounce ONLY — a conductor that is disabled,
  // a daemon that is off, and every bounded cap (serve-retry, timeout, empty-conduct) still stop
  // the pass exactly as they would have.
  if (url.pathname === '/api/conductor/kick' && req.method === 'POST') {
    let body: { project?: unknown; missionId?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }
    const project = typeof body.project === 'string' ? body.project.trim() : '';
    if (!project) return jsonError('project is required', 400);
    const missionId = typeof body.missionId === 'string' && body.missionId.trim().length > 0
      ? body.missionId.trim()
      : null;
    requestConductorKick(project, missionId);
    return Response.json({ ok: true, project, missionId, kicked: true });
  }

  return null;
}
