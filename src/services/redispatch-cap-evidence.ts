/**
 * Pure classifier for redispatch cap blocker cards.
 *
 * Split the wording by ledger evidence: gate-kill (every dispatch died before any node
 * ran, Σ nodesSpent = 0) vs blueprint-loop (multiple claims with nodesSpent > 0) vs
 * unknown (absence of evidence).
 *
 * Dependency-free (no store imports), so tests load this without the coordinator graph.
 */

export interface RedispatchClaim {
  session: string;
  nodesSpent: number;
}

export type RedispatchClassification = 'gate-killed' | 'blueprint-loop' | 'unknown';

/**
 * Classify a redispatch history by ledger evidence.
 *
 * - `claims.length === 0` → `'unknown'` (absence is not evidence).
 * - Σ `nodesSpent` === 0 over a non-empty history → `'gate-killed'`.
 * - more than one claim with `nodesSpent > 0` → `'blueprint-loop'`.
 * - anything else (exactly one paying claim, mixed single-payer) → `'unknown'`.
 *
 * Non-finite, negative, or missing `nodesSpent` treated as 0.
 */
export function classifyRedispatchHistory(claims: RedispatchClaim[]): RedispatchClassification {
  if (claims.length === 0) return 'unknown';

  let totalNodesSpent = 0;
  let payingClaims = 0;

  for (const claim of claims) {
    const spent = claim.nodesSpent ?? 0;
    const normalized = Number.isFinite(spent) && spent >= 0 ? spent : 0;
    totalNodesSpent += normalized;
    if (normalized > 0) payingClaims++;
  }

  // Non-empty history with all zero nodes → gate-killed.
  if (totalNodesSpent === 0) return 'gate-killed';

  // More than one claim paid nodes → blueprint-loop.
  if (payingClaims > 1) return 'blueprint-loop';

  // Single claim paid, or mixed (unknown).
  return 'unknown';
}

/**
 * Build the escalation `questionText` for a redispatch cap blocker.
 *
 * Branches by evidence class:
 * - `'gate-killed'`: states that every dispatch died before any node ran (no blueprint
 *   was ever paid), names the cause class, and points to `leaf_inspect`.
 * - `'blueprint-loop'` / `'unknown'`: returns the verbatim loop wording (no change).
 */
export function redispatchCapCardText(o: {
  title: string;
  todoId: string;
  dispatches: number;
  claims: RedispatchClaim[];
}): string {
  const classification = classifyRedispatchHistory(o.claims);

  if (classification === 'gate-killed') {
    return `Re-dispatch cap: "${o.title}" has been dispatched ${o.dispatches}× without reaching done/accepted — every dispatch died before any node ran, so no blueprint was ever paid. This is NOT a blueprint loop; it is a gate refusal or claim loss. PARKED (held) to stop wasting dispatch cycles. Investigate the root cause (\`leaf_inspect ${o.todoId.slice(0, 8)}\` for the gate rejection, claim loss, or reaper kill), fix the leaf spec / constraint, or drop it, then \`reset_todo\` to grant a fresh attempt.`;
  }

  // 'blueprint-loop' and 'unknown' use the current loop text verbatim.
  return `Re-dispatch cap: "${o.title}" has been dispatched ${o.dispatches}× without reaching done/accepted — each dispatch re-runs (and re-pays) a full blueprint, so this is a LOOP, not progress. PARKED (held) to stop the re-blueprint burn. Investigate the root cause (\`leaf_inspect ${o.todoId.slice(0, 8)}\` for the failure/parseError), fix the leaf spec / a bad constraint or drop it, then \`reset_todo\` to grant a fresh attempt.`;
}
