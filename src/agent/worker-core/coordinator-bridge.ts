/**
 * coordinator-bridge — builds WorkerCoreDeps backed by the LIVE in-process coordinator
 * funnel (the same getTodo / handleWorkerComplete / runGate / escalation path the
 * Claude + grok workers already use). This is the seam between the pure, testable
 * orchestrator and the running system.
 *
 * DYNAMIC imports for coordinator-live / coordinator-daemon / supervisor-store break
 * the adapter↔coordinator import cycle (same reason grok-own uses them). todo-store +
 * resolve-model are cycle-free → imported statically. Deps are built PER todo (the
 * bridge closes over project/todoId so the cwd-only runScopedGate can reach the
 * authoritative, todo-scoped gate).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTodo as storeGetTodo } from '../../services/todo-store';
import { resolveModel, anthropicAvailable, grokAvailable, providerAvailable, PROVIDER_IDS, DEFAULT_MODEL_BY_PROVIDER } from './resolve-model';
import { getConfig } from '../../services/config-service';
import { getTierOverride, type TierScope } from '../../services/tier-override-store';
import { getOrchestratorLevel } from '../../services/orchestrator-config';
import type { WorkerCoreDeps, GateOutcome } from './orchestrator';
import type { ProviderId } from '../worker-agent';
import type { SubloopRole } from './capabilities';

/** Scoping context for the tier-resolution walk (design-worker-fabric-ui §3). */
export interface RouteCtx {
  project?: string;
  epicId?: string;
  level?: string;
}

export type WinningScope = 'epic' | 'project' | 'level' | 'global' | 'default' | 'base';

/** Tier matrix: an EXPLICIT phase→provider routing, independent of the todo's pin.
 *  JUDGMENT phases (sizegate/research/verify/review) route to Claude — the bakeoff
 *  showed grok-build drifts on judgment — while the high-volume IMPLEMENT phase routes
 *  to the cheap grok-build EVEN when the todo is pinned to claude (the whole point of
 *  phase-routing: don't burn the expensive model on bulk implementation). Each tier
 *  falls back to the run's base provider when its preferred provider has no key, so the
 *  recipe never hard-fails on a missing key. This is the DEFAULT; per-phase config
 *  keys (resolveTierRoute) override it. */
const JUDGMENT_PHASES = new Set<SubloopRole>(['sizegate', 'research', 'authortests', 'verify', 'review']);

export interface BridgeOpts {
  /** Base provider for this run — the per-tier fallback when the tier's preferred
   *  provider isn't configured. */
  provider: ProviderId;
  /** Optional per-phase model override (e.g. Opus for a hard blueprint). */
  modelByPhase?: (phase: SubloopRole) => string | undefined;
}

/** The provider for a phase under the DEFAULT tier matrix. Judgment → claude (or base
 *  if no key); implement → grok-build (or base if no key) regardless of the run's pin. */
export function providerForPhase(phase: SubloopRole, base: ProviderId): ProviderId {
  if (JUDGMENT_PHASES.has(phase)) return anthropicAvailable() ? 'claude' : base;
  // implement (the high-volume phase): the cheap grok-build always wins over the pin.
  return grokAvailable() ? 'grok-build' : base;
}

/** Per-phase config keys that OVERRIDE the default tier matrix (flat string keys,
 *  mirroring the JUDGMENT_PROVIDER precedent — Secrets-UI editable, no JSON parsing).
 *  `WORKER_PROVIDER_<PHASE>` picks the provider; optional `WORKER_MODEL_<PHASE>` pins
 *  the model. Unset → the default providerForPhase tier (byte-identical to today).
 *  DEFERRED (no evidence yet): per-autonomy-level routing — add a level dimension when
 *  a concrete case appears, not before. */
const PHASE_CONFIG_SUFFIX: Record<SubloopRole, string> = {
  sizegate: 'SIZEGATE',
  research: 'RESEARCH',
  authortests: 'AUTHORTESTS',
  implement: 'IMPLEMENT',
  verify: 'VERIFY',
  review: 'REVIEW',
};

function parseProviderId(raw: string | undefined): ProviderId | null {
  return raw && (PROVIDER_IDS as string[]).includes(raw) ? (raw as ProviderId) : null;
}

/** Resolve the (provider, model?) for a phase: a configured, AVAILABLE per-phase
 *  override wins; otherwise the default tier (providerForPhase). A configured override
 *  whose provider can't run (missing key / unwired, e.g. codex) is ignored and the
 *  default tier is used — strictly smarter than falling to the raw base, and it never
 *  hard-fails. NOTE: removing a provider's key later silently re-routes that phase to
 *  the default tier on the next run (intended — never block on a missing key). */
export function resolveTierRoute(
  phase: SubloopRole,
  base: ProviderId,
  ctx: RouteCtx = {},
): { provider: ProviderId; model?: string; source: 'default' | 'override'; winningScope: WinningScope } {
  // Ordered walk, first AVAILABLE match wins; fall through on miss OR on a provider
  // whose key is missing (keyless-safe). epic > project > level > global > default > base.
  const fromScope = (scope: TierScope, scopeId?: string) => {
    if (!scopeId) return null;
    const o = getTierOverride(scope, scopeId, phase);
    const pid = parseProviderId(o?.provider);
    if (o && pid && providerAvailable(pid)) {
      return { provider: pid, model: o.model ?? undefined };
    }
    return null;
  };
  const epic = fromScope('epic', ctx.epicId);
  if (epic) return { ...epic, source: 'override', winningScope: 'epic' };
  const proj = fromScope('project', ctx.project);
  if (proj) return { ...proj, source: 'override', winningScope: 'project' };
  const lvl = fromScope('level', ctx.level);
  if (lvl) return { ...lvl, source: 'override', winningScope: 'level' };
  // Global config keys (WORKER_PROVIDER_<PHASE>).
  const suffix = PHASE_CONFIG_SUFFIX[phase];
  const g = parseProviderId(getConfig(`WORKER_PROVIDER_${suffix}`));
  if (g && providerAvailable(g)) {
    return { provider: g, model: getConfig(`WORKER_MODEL_${suffix}`) || undefined, source: 'override', winningScope: 'global' };
  }
  // Default tier (judgment→claude, implement→grok; base when keyless).
  const def = providerForPhase(phase, base);
  return { provider: def, source: 'default', winningScope: def === base && !providerAvailable(def) ? 'base' : 'default' };
}

/** WorkerCoreDeps wired to the real coordinator for one todo. */
export function makeCoordinatorWorkerDeps(project: string, todoId: string, opts: BridgeOpts): WorkerCoreDeps {
  const session = `worker-${todoId.slice(0, 8)}`;
  // Resolve the scoping context ONCE per todo: the epic (parentId) and the project's
  // autonomy level drive the tier-resolution walk. Best-effort — a failure leaves the
  // scope undefined and the walk falls through to global/default (byte-identical).
  let ctx: RouteCtx = { project };
  try {
    const t = storeGetTodo(project, todoId);
    ctx = { project, epicId: t?.parentId ?? undefined, level: getOrchestratorLevel(project) };
  } catch {
    /* keep { project } */
  }
  // Capture the lane's claim token at LANE START (deps are built PER todo), not at
  // completion — a token read at completion time would always match the current row
  // and defeat the CAS.
  const laneClaimToken = storeGetTodo(project, todoId)?.claim?.token ?? undefined;
  return {
    getTodo: (p, id) => {
      const t = storeGetTodo(p, id);
      return t ? { todoId: t.id, title: t.title, description: t.description ?? undefined } : null;
    },

    resolveModel: (phase) => {
      // Scoped tier matrix walk (epic > project > level > global > default); each tier
      // keyless-safe. A WORKER_MODEL override or an explicit modelByPhase pins the model.
      const route = resolveTierRoute(phase, opts.provider, ctx);
      const model = route.model ?? opts.modelByPhase?.(phase);
      return resolveModel(route.provider, model);
    },

    describeRoute: (phase) => {
      // Same resolution the resolveModel dep uses, surfaced as a typed routing decision
      // for observability (which provider+model ran this phase, and WHY — winningScope).
      const route = resolveTierRoute(phase, opts.provider, ctx);
      const model = route.model ?? opts.modelByPhase?.(phase) ?? DEFAULT_MODEL_BY_PROVIDER[route.provider];
      return { provider: route.provider, model, source: route.source, winningScope: route.winningScope };
    },

    runScopedGate: async (): Promise<GateOutcome> => {
      // The authoritative gate resolves the lane worktree from the todo itself, so the
      // cwd arg is informational; we close over project/todoId and call the same runGate.
      const { makeCoordinatorDeps } = await import('../../services/coordinator-live');
      const runGate = makeCoordinatorDeps().runGate;
      if (!runGate) return { pass: true, errorSignatures: [] }; // no declared gate → preserve trust
      const v = await runGate(project, todoId);
      if (!v) return { pass: true, errorSignatures: [] };
      return { pass: v.passed, errorSignatures: v.passed ? [] : v.reasons };
    },

    readWorktreeFiles: (laneCwd, paths) => {
      // Snapshot the authored spec-test files for the anti-tamper guard. Path-guarded to
      // the lane worktree; a missing/unreadable file reads as null (treated as changed
      // if it later appears, which is the safe direction).
      const out: Record<string, string | null> = {};
      for (const rel of paths) {
        try {
          const abs = resolve(laneCwd, rel);
          out[rel] = abs.startsWith(laneCwd) ? readFileSync(abs, 'utf8') : null;
        } catch {
          out[rel] = null;
        }
      }
      return out;
    },

    completeAccepted: async (p, id) => {
      const { makeCoordinatorDeps } = await import('../../services/coordinator-live');
      const { handleWorkerComplete } = await import('../../services/coordinator-daemon');
      await handleWorkerComplete(makeCoordinatorDeps(), p, id, 'accepted', laneClaimToken);
    },

    escalate: async (p, id, kind, detail) => {
      const { createEscalation } = await import('../../services/supervisor-store');
      createEscalation({ project: p, session, todoId: id, kind, questionText: detail });
    },
  };
}
