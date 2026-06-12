/**
 * Server-authoritative completion resolver (PAW P1, ride-along).
 *
 * A worker only ever PROPOSES an acceptance. Two independent server checks decide
 * the EFFECTIVE outcome, in order:
 *
 *   1. GATE (5374e299) — the project's declared mechanical gate runs on the
 *      committed artifact. A failed (or un-runnable, fail-closed) gate overrides
 *      'accepted' → 'rejected'. No declared gate preserves the prior trust.
 *
 *   2. WORK-COMMITTED re-verify (this change) — even a gate-green 'accepted' is
 *      downgraded to 'pending' when the worker's lane has NO actual work to
 *      integrate (a clean worktree with nothing committed). This closes the
 *      HALLUCINATED-COMPLETION hole: a worker that calls complete_todo without
 *      ever editing/committing anything no longer lands 'done' — it resolves
 *      'pending' and is re-examined.
 *
 * RIDE-ALONG: this is invoked from handleWorkerComplete, the SINGLE completion
 * funnel both lanes (the coordinator daemon's Build pass AND the MCP complete_todo
 * verb) delegate to — so both get the gate + re-verify uniformly.
 *
 * Fail-direction matters and is deliberate:
 *   - the gate fails CLOSED (an erroring gate must not auto-accept), whereas
 *   - the work-committed probe fails OPEN (an erroring/indeterminate probe must
 *     NOT false-downgrade legitimate work) — only an explicit `false` (provably
 *     no work) downgrades to pending. Net: strictly never-worse than today.
 */
import type { GateVerdict } from '../services/coordinator-daemon';

/** The effective, server-decided acceptance after the gate + re-verify. */
export type EffectiveAcceptance = 'accepted' | 'rejected' | 'pending';

export interface CompletionResolverDeps {
  /** Run the project's declared mechanical gate. null → no applicable gate
   *  (preserve the worker's self-report). */
  runGate?: (project: string, todoId: string) => Promise<GateVerdict | null>;
  /** Re-verify the worker's lane has real, committable work. Returns:
   *    true  → work exists (a dirty worktree or commits ahead of the epic base),
   *    false → provably no work (clean tree, nothing committed) → downgrade,
   *    null  → indeterminate (non-isolation / non-git / no lane worktree) →
   *            preserve the prior behavior (treat as committed). */
  verifyWorkCommitted?: (project: string, todoId: string) => Promise<boolean | null>;
}

export interface CompletionResolution {
  effective: EffectiveAcceptance;
  /** Present when the gate overrode an 'accepted' to 'rejected'. */
  gateOverride?: GateVerdict;
  /** Present when the work-committed re-verify downgraded 'accepted' to 'pending'. */
  pendingReason?: string;
}

/** Decide the effective acceptance for a worker completion. Pure of any store
 *  mutation — the caller (handleWorkerComplete) applies `effective` via completeTodo. */
export async function resolveCompletion(
  deps: CompletionResolverDeps,
  project: string,
  todoId: string,
  acceptance: 'accepted' | 'rejected',
): Promise<CompletionResolution> {
  // A worker-declared 'rejected' is taken at face value (it failed its own gate
  // in-scope) — no re-verify, nothing to downgrade.
  if (acceptance !== 'accepted') {
    return { effective: acceptance };
  }

  // 1. GATE — fail CLOSED.
  if (deps.runGate) {
    let verdict: GateVerdict | null;
    try {
      verdict = await deps.runGate(project, todoId);
    } catch (e) {
      verdict = { passed: false, reasons: [`gate execution error: ${e instanceof Error ? e.message : String(e)}`] };
    }
    if (verdict && !verdict.passed) {
      return { effective: 'rejected', gateOverride: verdict };
    }
  }

  // 2. WORK-COMMITTED re-verify — fail OPEN (only an explicit false downgrades).
  if (deps.verifyWorkCommitted) {
    let committed: boolean | null;
    try {
      committed = await deps.verifyWorkCommitted(project, todoId);
    } catch {
      committed = null; // probe error → indeterminate → preserve (never false-downgrade)
    }
    if (committed === false) {
      return {
        effective: 'pending',
        pendingReason:
          'hallucinated completion: the lane has no committable work (clean worktree, nothing committed) — resolved pending, not accepted',
      };
    }
  }

  return { effective: 'accepted' };
}
