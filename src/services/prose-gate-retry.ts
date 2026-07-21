/**
 * prose-gate-retry.ts — pure disposition helper for the prose-gate fix loop.
 *
 * The executor keeps PER-LEAF offense counters (per gate KIND, plus an overall total)
 * and feeds them in here; this module holds NO state (no module-global counter) so
 * leaves that share the module cannot cross-contaminate each other's within-leaf
 * scoping. Pure, no I/O, no spawn — mirrors review-citations.ts's posture.
 */

export interface ProseGateDisposition {
  action: 'retry' | 'park';
}

/** Overall ceiling (independent of per-kind counting): a leaf can chain at most this
 *  many distinct-kind prose retries before a further offense parks regardless of kind —
 *  otherwise N different one-shot gate kinds could retry unboundedly. */
export const MAX_TOTAL_PROSE_RETRIES = 2;

/**
 * Per-GATE-KIND disposition (FIX: a single run-wide counter previously parked a leaf on
 * its SECOND offense even when the two offenses were different gates on legitimately
 * different cycles — e.g. review-vacuous then command-evidence). Now:
 *   - first offense of a given `kind` (offenseCountForKind === 1) → retry
 *   - second-or-later offense of the SAME `kind` (offenseCountForKind >= 2) → park
 *   - regardless of kind, once {@link MAX_TOTAL_PROSE_RETRIES} retries have already been
 *     granted across ALL kinds, any further offense (a 3rd distinct kind, or a repeat)
 *     parks — the overall ceiling a leaf can never exceed.
 * The caller passes its OWN per-leaf counters; this fn reads no shared state.
 */
export function proseGateDisposition(
  { offenseCountForKind, totalOffenseCountSoFar }: { offenseCountForKind: number; totalOffenseCountSoFar: number },
): ProseGateDisposition {
  if (offenseCountForKind >= 2) return { action: 'park' };
  if (totalOffenseCountSoFar > MAX_TOTAL_PROSE_RETRIES) return { action: 'park' };
  return { action: 'retry' };
}

/**
 * A FIXED, NON-EMPTY remediation string embedding `reason`. STABLE across calls
 * with the same reason (deterministic — no timestamps/random) so the executor's
 * isRepeat findings-equality can fire on a genuine repeat.
 */
export function synthProseFindings(reason: string): string {
  return `Prose gate not satisfied — re-run review and cite file:line evidence for each MET/UNMET criterion. Detail: ${reason}`;
}
