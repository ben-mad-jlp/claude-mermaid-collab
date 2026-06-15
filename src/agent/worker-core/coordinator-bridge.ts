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
import { resolveModel } from './resolve-model';
import type { WorkerCoreDeps, GateOutcome } from './orchestrator';
import type { ProviderId } from '../worker-agent';
import type { SubloopRole } from './capabilities';

export interface BridgeOpts {
  /** Provider for this run (grok-build today). */
  provider: ProviderId;
  /** Optional per-phase model override (the tier matrix: Opus plan / Haiku impl / …). */
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

    resolveModel: (phase) => resolveModel(opts.provider, opts.modelByPhase?.(phase)),

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
