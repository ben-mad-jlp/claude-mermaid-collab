import {
  getOrchestratorLevel,
  setOrchestratorLevel,
  getProjectPoolSize,
  setProjectPoolSize,
  getProjectEffort,
  setProjectEffort,
  listNodeProfileOverrides,
  setNodeProfileOverride,
  copyNodeProfilesTo,
  getProjectNodeProvider,
  setProjectNodeProvider,
  NODE_PROVIDERS,
  EFFORT_LEVELS,
  ORCH_LEVELS,
  type OrchestratorLevel,
  type NodeProviderId,
} from '../services/orchestrator-config.ts';
import type { EffortLevel } from '../agent/contracts.ts';
import { NODE_PROFILE, LEAF_NODE_KINDS, NODE_KIND_DESCRIPTIONS } from '../services/leaf-executor.ts';
import { projectRegistry } from '../services/project-registry.ts';

/** Node kinds shown in the daemon BUILD-nodes matrix. Excludes 'summary', which is the
 *  Zen interpret-model knob (never run via runNode), not a build node. */
const MATRIX_NODE_KINDS = LEAF_NODE_KINDS.filter((k) => k !== 'summary');

/** Model aliases offered in the daemon-nodes matrix dropdown, per provider. */
const CLAUDE_MODEL_CHOICES = ['opus', 'sonnet', 'haiku'];
const GROK_MODEL_CHOICES = ['grok-build', 'grok-composer-2.5-fast'];
const MODEL_CHOICES = CLAUDE_MODEL_CHOICES; // legacy alias (claude) for back-compat callers
/** A node kind is MCP-forced to claude when its allowlist carries an mcp__ tool. */
function kindRequiresMcp(kind: keyof typeof NODE_PROFILE): boolean {
  return NODE_PROFILE[kind].allowedTools.includes('mcp__');
}
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
    const projectProvider = getProjectNodeProvider(project); // per-project default provider
    const rows = MATRIX_NODE_KINDS.map((kind) => {
      const def = NODE_PROFILE[kind];
      const o = overrides[kind] ?? { model: null, effort: null, provider: null };
      const mcpForced = kindRequiresMcp(kind);
      // Effective provider mirrors resolveNodeProvider's DB precedence (mcp guard →
      // per-kind → project default → claude). Env/config knobs are not surfaced here.
      const effectiveProvider = mcpForced ? 'claude' : (o.provider ?? projectProvider ?? 'claude');
      return {
        kind,
        desc: NODE_KIND_DESCRIPTIONS[kind],
        defaultModel: def.model,
        defaultEffort: def.effort,
        modelOverride: o.model,
        effortOverride: o.effort,
        providerOverride: o.provider,
        effectiveModel: o.model ?? def.model,
        effectiveEffort: o.effort ?? projectEffort ?? def.effort,
        effectiveProvider,
        mcpForced, // UI locks the provider selector to claude for these rows
      };
    });
    return Response.json({
      project,
      rows,
      models: MODEL_CHOICES,
      claudeModels: CLAUDE_MODEL_CHOICES,
      grokModels: GROK_MODEL_CHOICES,
      providers: NODE_PROVIDERS,
      projectProvider,
      levels: EFFORT_LEVELS,
    });
  }

  // POST /api/orchestrator/node-profiles { project, kind, model, effort, provider }
  // any field null = clear it (inherit). All null = remove the override row.
  if (url.pathname === '/api/orchestrator/node-profiles' && req.method === 'POST') {
    try {
      const { project, kind, model, effort, provider } = (await req.json()) as {
        project?: string; kind?: string; model?: string | null; effort?: string | null; provider?: string | null;
      };
      if (!project) return jsonError('project is required', 400);
      if (!kind || !(LEAF_NODE_KINDS as string[]).includes(kind)) {
        return jsonError(`kind must be one of: ${LEAF_NODE_KINDS.join(', ')}`, 400);
      }
      if (effort != null && !(EFFORT_LEVELS as string[]).includes(effort)) {
        return jsonError(`effort must be null or one of: ${EFFORT_LEVELS.join(', ')}`, 400);
      }
      if (provider != null && !(NODE_PROVIDERS as readonly string[]).includes(provider)) {
        return jsonError(`provider must be null or one of: ${NODE_PROVIDERS.join(', ')}`, 400);
      }
      // Guard the MCP-forced kinds: they can never run on grok.
      if (provider === 'grok-build' && kindRequiresMcp(kind as keyof typeof NODE_PROFILE)) {
        return jsonError(`node kind '${kind}' uses MCP tools and must run on claude`, 400);
      }
      setNodeProfileOverride(
        project, kind, model ?? null, (effort ?? null) as EffortLevel | null, (provider ?? null) as NodeProviderId | null,
      );
      return Response.json({ project, kind, model: model ?? null, effort: effort ?? null, provider: provider ?? null });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // GET /api/orchestrator/node-provider?project=<abs path>  → per-project DEFAULT provider
  if (url.pathname === '/api/orchestrator/node-provider' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) return jsonError('project is required', 400);
    return Response.json({ project, nodeProvider: getProjectNodeProvider(project), choices: NODE_PROVIDERS });
  }

  // POST /api/orchestrator/node-provider { project, nodeProvider }  (null → clear)
  if (url.pathname === '/api/orchestrator/node-provider' && req.method === 'POST') {
    try {
      const { project, nodeProvider } = (await req.json()) as { project?: string; nodeProvider?: string | null };
      if (!project) return jsonError('project is required', 400);
      if (nodeProvider != null && !(NODE_PROVIDERS as readonly string[]).includes(nodeProvider)) {
        return jsonError(`nodeProvider must be null or one of: ${NODE_PROVIDERS.join(', ')}`, 400);
      }
      setProjectNodeProvider(project, (nodeProvider ?? null) as NodeProviderId | null);
      return Response.json({ project, nodeProvider: getProjectNodeProvider(project), choices: NODE_PROVIDERS });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Unknown error', 500);
    }
  }

  // POST /api/orchestrator/node-profiles/broadcast { project }
  // Push this project's node model+effort matrix to EVERY other registered project
  // (replacing theirs). Returns how many projects were updated.
  if (url.pathname === '/api/orchestrator/node-profiles/broadcast' && req.method === 'POST') {
    try {
      const { project } = (await req.json()) as { project?: string };
      if (!project) return jsonError('project is required', 400);
      const targets = (await projectRegistry.list()).map((p) => p.path);
      const applied = copyNodeProfilesTo(project, targets);
      return Response.json({ project, applied, totalProjects: targets.length });
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
