import {
  getOrchestratorLevel,
  setOrchestratorLevel,
  ORCH_LEVELS,
  type OrchestratorLevel,
} from '../services/orchestrator-config.ts';
import { confirmSuggestion, dismissSuggestion } from '../services/triage-execute.ts';

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleOrchestratorRoutes(req: Request, url: URL): Promise<Response | null> {
  // GET /api/orchestrator/level?project=<abs path>
  if (url.pathname === '/api/orchestrator/level' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    const level = getOrchestratorLevel(project);
    return Response.json({ project, level });
  }

  // POST /api/orchestrator/level { project, level }
  if (url.pathname === '/api/orchestrator/level' && req.method === 'POST') {
    try {
      const { project, level } = (await req.json()) as { project?: string; level?: string };
      if (!project) return jsonError('project is required', 400);
      if (!level) return jsonError('level is required', 400);
      if (!(ORCH_LEVELS as string[]).includes(level)) {
        return jsonError(`level must be one of: ${ORCH_LEVELS.join(', ')}`, 400);
      }
      setOrchestratorLevel(project, level as OrchestratorLevel);
      return Response.json({ project, level: level as OrchestratorLevel });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/orchestrator/escalation/:id/confirm-suggestion { project }
  // Confirm the inline Grok suggestion: re-validate its proof through the server
  // proof gate, then apply the verb. NEVER mutates without a re-derived proof.
  const confirmMatch = url.pathname.match(/^\/api\/orchestrator\/escalation\/([^/]+)\/confirm-suggestion$/);
  if (confirmMatch && req.method === 'POST') {
    try {
      const id = decodeURIComponent(confirmMatch[1]);
      const { project } = (await req.json()) as { project?: string };
      if (!project) return jsonError('project is required', 400);
      const result = await confirmSuggestion(project, id);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/orchestrator/escalation/:id/dismiss-suggestion { project }
  // Clear the inline suggestion; the escalation stays open for the human.
  const dismissMatch = url.pathname.match(/^\/api\/orchestrator\/escalation\/([^/]+)\/dismiss-suggestion$/);
  if (dismissMatch && req.method === 'POST') {
    try {
      const id = decodeURIComponent(dismissMatch[1]);
      const { project } = (await req.json()) as { project?: string };
      if (!project) return jsonError('project is required', 400);
      const result = dismissSuggestion(project, id);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // GET /api/orchestrator/health
  if (url.pathname === '/api/orchestrator/health' && req.method === 'GET') {
    // The orchestrator daemon (orchestrator-live.ts) does not exist yet.
    // Dynamically attempt to import it so this compiles today; if absent,
    // fall back gracefully to { running: false }.
    try {
      const mod = await import('../services/orchestrator-live.ts' as string);
      if (typeof mod.getOrchestratorHealth === 'function') {
        return Response.json(mod.getOrchestratorHealth());
      }
      return Response.json({ running: false });
    } catch {
      return Response.json({ running: false });
    }
  }

  return null;
}
