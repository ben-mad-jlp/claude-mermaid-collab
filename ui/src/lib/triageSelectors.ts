import type { Escalation } from '@/stores/supervisorStore';

// NOTE: `ProgressState` / `SessionSummary` mirror the shapes the store-slice task
// adds to `@/stores/supervisorStore`. They are declared locally here (rather than
// imported) so this pure selector module compiles independently of store edits.
// They are structurally identical to the store's interfaces.
export type ProgressState = 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown';

export interface SessionSummary {
  project: string;
  session: string;
  progressState: ProgressState;
  paneSeenAt: number;
  updatedAt: number;
  snoozedUntil?: number;
}

export type TriageItem =
  | { kind: 'escalation'; severity: number; since: number; escalation: Escalation }
  | { kind: 'wedge';      severity: number; since: number; summary: SessionSummary }
  | { kind: 'unknown';    severity: number; since: number; summary: SessionSummary };

// Severity tiers — HIGHER = more urgent. The load-bearing invariant (Z4):
// operatorGated escalations AND wedged sessions share the TOP tier, strictly
// above routine approvals/decisions.
export const SEV_GATED_OR_WEDGED = 3; // operatorGated escalation | wedged session
export const SEV_ROUTINE        = 2; // any other open escalation (approval/decision/etc.)
export const SEV_UNKNOWN_SOFT   = 1; // unknown-liveness session

export function escalationSeverity(e: Escalation): number {
  // `operatorGated` arrives on the wire (0|1) from mapEscalationRow's column
  // spread; the store-slice task declares it on `Escalation`. Read it defensively
  // so this module compiles whether or not that declaration has landed.
  const operatorGated = (e as { operatorGated?: boolean | number }).operatorGated;
  return operatorGated ? SEV_GATED_OR_WEDGED : SEV_ROUTINE;
}

/** Build the merged triage stack. Sorted by severity DESC, then age ASC
 *  (oldest `since` first within a tier). Snoozed sessions are excluded. */
export function selectTriageStack(
  openEscalations: Escalation[],
  sessionSummaries: Record<string, SessionSummary>,
  now: number,
): TriageItem[] {
  const items: TriageItem[] = [];

  for (const e of openEscalations) {
    if (e.status !== 'open') continue;
    items.push({ kind: 'escalation', severity: escalationSeverity(e), since: e.createdAt, escalation: e });
  }

  for (const s of Object.values(sessionSummaries)) {
    if (s.snoozedUntil && now < s.snoozedUntil) continue; // snoozed → out
    if (s.progressState === 'wedged') {
      items.push({ kind: 'wedge', severity: SEV_GATED_OR_WEDGED, since: s.paneSeenAt, summary: s });
    } else if (s.progressState === 'unknown') {
      items.push({ kind: 'unknown', severity: SEV_UNKNOWN_SOFT, since: s.paneSeenAt, summary: s });
    }
    // active/quiet/stalled do NOT enter the stack — stalled only tints the pill amber.
  }

  return items.sort((a, b) => (b.severity - a.severity) || (a.since - b.since));
}

export function selectTriageTop(
  openEscalations: Escalation[],
  sessionSummaries: Record<string, SessionSummary>,
  now: number,
): TriageItem | null {
  return selectTriageStack(openEscalations, sessionSummaries, now)[0] ?? null;
}

/** Minutes of no-progress for a wedged/unknown session, for the card label. */
export function wedgeMinutes(summary: SessionSummary, now: number): number {
  return Math.max(0, Math.floor((now - summary.paneSeenAt) / 60_000));
}
