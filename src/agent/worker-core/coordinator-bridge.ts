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
import { getTodo as storeGetTodo } from '../../services/todo-store';
import { resolveModel, anthropicAvailable, grokAvailable } from './resolve-model';
import type { WorkerCoreDeps, GateOutcome } from './orchestrator';
import type { ProviderId } from '../worker-agent';
import type { SubloopRole } from './capabilities';

/** Tier matrix: an EXPLICIT phase→provider routing, independent of the todo's pin.
 *  JUDGMENT phases (sizegate/research/verify/review) route to Claude — the bakeoff
 *  showed grok-build drifts on judgment — while the high-volume IMPLEMENT phase routes
 *  to the cheap grok-build EVEN when the todo is pinned to claude (the whole point of
 *  phase-routing: don't burn the expensive model on bulk implementation). Each tier
 *  falls back to the run's base provider when its preferred provider has no key, so the
 *  recipe never hard-fails on a missing key. */
const JUDGMENT_PHASES = new Set<SubloopRole>(['sizegate', 'research', 'verify', 'review']);

export interface BridgeOpts {
  /** Base provider for this run — the per-tier fallback when the tier's preferred
   *  provider isn't configured. */
  provider: ProviderId;
  /** Optional per-phase model override (e.g. Opus for a hard blueprint). */
  modelByPhase?: (phase: SubloopRole) => string | undefined;
}

/** The provider for a phase under the tier matrix. Judgment → claude (or base if no
 *  key); implement → grok-build (or base if no key) regardless of the run's pin. */
export function providerForPhase(phase: SubloopRole, base: ProviderId): ProviderId {
  if (JUDGMENT_PHASES.has(phase)) return anthropicAvailable() ? 'claude' : base;
  // implement (the high-volume phase): the cheap grok-build always wins over the pin.
  return grokAvailable() ? 'grok-build' : base;
}

/** WorkerCoreDeps wired to the real coordinator for one todo. */
export function makeCoordinatorWorkerDeps(project: string, todoId: string, opts: BridgeOpts): WorkerCoreDeps {
  const session = `worker-${todoId.slice(0, 8)}`;
  return {
    getTodo: (p, id) => {
      const t = storeGetTodo(p, id);
      return t ? { todoId: t.id, title: t.title, description: t.description ?? undefined } : null;
    },

    resolveModel: (phase) => {
      // Explicit tier matrix: judgment → claude, implement → grok-build (regardless
      // of the run's pin), each falling back to the base provider when keyless.
      const provider = providerForPhase(phase, opts.provider);
      return resolveModel(provider, opts.modelByPhase?.(phase));
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

    completeAccepted: async (p, id) => {
      const { makeCoordinatorDeps } = await import('../../services/coordinator-live');
      const { handleWorkerComplete } = await import('../../services/coordinator-daemon');
      await handleWorkerComplete(makeCoordinatorDeps(), p, id, 'accepted');
    },

    escalate: async (p, id, kind, detail) => {
      const { createEscalation } = await import('../../services/supervisor-store');
      createEscalation({ project: p, session, todoId: id, kind, questionText: detail });
    },
  };
}
