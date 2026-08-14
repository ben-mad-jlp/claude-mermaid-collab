// Read-only HTTP surface over the conductor_pass journal.
import { listConductorPassesPage } from '../services/conductor-pass-journal.js';
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

  return null;
}
