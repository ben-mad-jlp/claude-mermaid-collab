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
import { resolveModel, anthropicAvailable } from './resolve-model';
import type { WorkerCoreDeps, GateOutcome } from './orchestrator';
import type { ProviderId } from '../worker-agent';
import type { SubloopRole } from './capabilities';

/** Tier matrix: JUDGMENT phases (blueprint/research, verify, review, sizegate) route
 *  to Claude — the bakeoff showed grok-build drifts on judgment — while the high-volume
 *  IMPLEMENT phase stays on the cheap provider. Falls back to the base provider when no
 *  Anthropic key is configured, so the recipe never hard-fails on a missing key. */
const JUDGMENT_PHASES = new Set<SubloopRole>(['sizegate', 'research', 'verify', 'review']);

export interface BridgeOpts {
  /** Base provider for this run (grok-build) — used for implement + as the judgment fallback. */
  provider: ProviderId;
  /** Optional per-phase model override (e.g. Opus for a hard blueprint). */
  modelByPhase?: (phase: SubloopRole) => string | undefined;
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
      // Judgment phase + a key present → Claude; else the base provider (grok).
      const useClaude = JUDGMENT_PHASES.has(phase) && anthropicAvailable();
      const provider: ProviderId = useClaude ? 'claude' : opts.provider;
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
