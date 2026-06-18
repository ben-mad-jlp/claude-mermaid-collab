import {
  getOrchestratorLevel,
  setOrchestratorLevel,
  getProjectPoolSize,
  setProjectPoolSize,
  getProjectEffort,
  setProjectEffort,
  listNodeProfileOverrides,
  setNodeProfileOverride,
  EFFORT_LEVELS,
  ORCH_LEVELS,
  type OrchestratorLevel,
} from '../services/orchestrator-config.ts';
import type { EffortLevel } from '../agent/contracts.ts';
import { NODE_PROFILE, LEAF_NODE_KINDS } from '../services/leaf-executor.ts';

/** Model aliases offered in the daemon-nodes matrix dropdown. */
const MODEL_CHOICES = ['opus', 'sonnet', 'haiku'];
import { DEFAULT_SLOTS_PER_TYPE, MAX_POOL_SIZE } from '../services/worker-pool.ts';
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

  // GET /api/orchestrator/pool-size?project=<abs path>
  // Returns the per-project pool size (null = using the global default), plus the
  // default + max so the UI can render the control without hardcoding them.
  if (url.pathname === '/api/orchestrator/pool-size' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    return Response.json({ project, poolSize: getProjectPoolSize(project), default: DEFAULT_SLOTS_PER_TYPE, max: MAX_POOL_SIZE });
  }

  // POST /api/orchestrator/pool-size { project, poolSize }  (poolSize null → clear)
  if (url.pathname === '/api/orchestrator/pool-size' && req.method === 'POST') {
    try {
      const { project, poolSize } = (await req.json()) as { project?: string; poolSize?: number | null };
      if (!project) return jsonError('project is required', 400);
      if (poolSize != null && (typeof poolSize !== 'number' || !Number.isFinite(poolSize))) {
        return jsonError('poolSize must be a number or null', 400);
      }
      setProjectPoolSize(project, poolSize ?? null);
      return Response.json({ project, poolSize: getProjectPoolSize(project), default: DEFAULT_SLOTS_PER_TYPE, max: MAX_POOL_SIZE });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // GET /api/orchestrator/effort?project=<abs path>
  // effort null = 'auto' (per-node-kind defaults). Surfaces the allowed levels.
  if (url.pathname === '/api/orchestrator/effort' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    return Response.json({ project, effort: getProjectEffort(project), levels: EFFORT_LEVELS });
  }

  // POST /api/orchestrator/effort { project, effort }  (effort null → auto/defaults)
  if (url.pathname === '/api/orchestrator/effort' && req.method === 'POST') {
    try {
      const { project, effort } = (await req.json()) as { project?: string; effort?: string | null };
      if (!project) return jsonError('project is required', 400);
      if (effort != null && !(EFFORT_LEVELS as string[]).includes(effort)) {
        return jsonError(`effort must be null or one of: ${EFFORT_LEVELS.join(', ')}`, 400);
      }
      setProjectEffort(project, (effort ?? null) as EffortLevel | null);
      return Response.json({ project, effort: getProjectEffort(project), levels: EFFORT_LEVELS });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // GET /api/orchestrator/node-profiles?project=<abs path>
  // The per-node-kind model + effort matrix: defaults, this project's overrides, and
  // the effective resolved values, plus the choice lists for the editor dropdowns.
  if (url.pathname === '/api/orchestrator/node-profiles' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    const overrides = listNodeProfileOverrides(project);
    const projectEffort = getProjectEffort(project); // per-project blanket fallback
    const rows = LEAF_NODE_KINDS.map((kind) => {
      const def = NODE_PROFILE[kind];
      const o = overrides[kind] ?? { model: null, effort: null };
      return {
        kind,
        defaultModel: def.model,
        defaultEffort: def.effort,
        modelOverride: o.model,
        effortOverride: o.effort,
        effectiveModel: o.model ?? def.model,
        effectiveEffort: o.effort ?? projectEffort ?? def.effort,
      };
    });
    return Response.json({ project, rows, models: MODEL_CHOICES, levels: EFFORT_LEVELS });
  }

  // POST /api/orchestrator/node-profiles { project, kind, model, effort }
  // model/effort null = clear that field (inherit). Both null = remove the override.
  if (url.pathname === '/api/orchestrator/node-profiles' && req.method === 'POST') {
    try {
      const { project, kind, model, effort } = (await req.json()) as {
        project?: string; kind?: string; model?: string | null; effort?: string | null;
      };
      if (!project) return jsonError('project is required', 400);
      if (!kind || !(LEAF_NODE_KINDS as string[]).includes(kind)) {
        return jsonError(`kind must be one of: ${LEAF_NODE_KINDS.join(', ')}`, 400);
      }
      if (effort != null && !(EFFORT_LEVELS as string[]).includes(effort)) {
        return jsonError(`effort must be null or one of: ${EFFORT_LEVELS.join(', ')}`, 400);
      }
      setNodeProfileOverride(project, kind, model ?? null, (effort ?? null) as EffortLevel | null);
      return Response.json({ project, kind, model: model ?? null, effort: effort ?? null });
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
      // BUG 7fb16985: use the SAME './services/orchestrator-live.js' specifier the
      // daemon lifecycle (server.ts) and system_status use, so Bun resolves ONE
      // module record (shared `timer`/level state) — not a second '.ts' instance
      // that would report a stale running:false.
      const mod = await import('../services/orchestrator-live.js' as string);
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
