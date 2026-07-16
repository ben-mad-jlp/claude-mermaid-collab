/**
 * prose-gate-retry.ts — pure disposition helper for the prose-gate fix loop.
 *
 * The executor keeps a PER-LEAF offense counter and feeds it in here; this module
 * holds NO state (no module-global counter) so leaves that share the module cannot
 * cross-contaminate each other's within-leaf scoping. Pure, no I/O, no spawn —
 * mirrors review-citations.ts's posture.
 */

export interface ProseGateDisposition {
  action: 'retry' | 'park';
}

/**
 * First offense (offenseCountSoFar === 1) → retry; second or later (>= 2) → park.
 * The caller passes its OWN per-leaf counter; this fn reads no shared state.
 */
export function proseGateDisposition(
  { offenseCountSoFar }: { offenseCountSoFar: number },
): ProseGateDisposition {
  return offenseCountSoFar >= 2 ? { action: 'park' } : { action: 'retry' };
}

/**
 * A FIXED, NON-EMPTY remediation string embedding `reason`. STABLE across calls
 * with the same reason (deterministic — no timestamps/random) so the executor's
 * isRepeat findings-equality can fire on a genuine repeat.
 */
export function synthProseFindings(reason: string): string {
  return `Prose gate not satisfied — re-run review and cite file:line evidence for each MET/UNMET criterion. Detail: ${reason}`;
}
