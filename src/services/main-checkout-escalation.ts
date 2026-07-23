/** Adapter turning a main-checkout invariant violation into a durable escalation card.
 *
 * Imports createEscalation lazily (require, not a static import) so that merely importing
 * worktree-manager never opens the supervisor DB (mirrors the dynamic-import discipline at
 * src/agent/worker-core/coordinator-bridge.ts:190).
 */

import type {
  MainCheckoutBranchChangedError,
  MainCheckoutResidueError,
} from './main-checkout-invariant';

type CreateEscalationFn = typeof import('./supervisor-store').createEscalation;

function describeViolation(
  err: MainCheckoutResidueError | MainCheckoutBranchChangedError,
): string {
  if (err.name === 'MainCheckoutResidueError') {
    const residueErr = err as MainCheckoutResidueError;
    return residueErr.addedResidue.join('\n');
  }
  const branchErr = err as MainCheckoutBranchChangedError;
  const { before, after } = branchErr;
  if (before.branch !== after.branch) {
    return `branch changed from ${before.branch ?? 'detached'} to ${after.branch ?? 'detached'}`;
  }
  return `detached HEAD changed from ${before.sha} to ${after.sha}`;
}

export function escalateMainCheckoutViolation(
  err: MainCheckoutResidueError | MainCheckoutBranchChangedError,
  deps?: { createEscalation?: CreateEscalationFn },
): void {
  try {
    const createEscalation =
      deps?.createEscalation ?? (require('./supervisor-store') as typeof import('./supervisor-store')).createEscalation;

    const questionText = [
      `op: ${err.opName}`,
      `project: ${err.projectRoot}`,
      describeViolation(err),
    ].join('\n');

    createEscalation({
      project: err.projectRoot,
      session: 'daemon',
      kind: 'main-checkout-residue',
      questionText,
      operatorGated: true,
    });
  } catch {
    /* best-effort: never let escalation adapter failure mask the underlying invariant error */
  }
}
