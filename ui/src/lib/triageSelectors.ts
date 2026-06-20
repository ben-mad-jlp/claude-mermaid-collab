import type { Escalation } from '@/stores/supervisorStore';

// NOTE: `ProgressState` / `SessionSummary` mirror the shapes the store-slice task
// adds to `@/stores/supervisorStore`. They are declared locally here (rather than
// imported) so this pure selector module compiles independently of store edits.
// They are structurally identical to the store's interfaces.
//
// MOBILE-PARITY INVARIANT (Z9): Every triage-zone selector is a pure function over
// `(openEscalations, sessionSummaries)` — both populated exclusively from HTTP
// hydrate + WS ingest in the store. No DOM, no `window`, no `Date.now()` in this
// module (callers inject `now`). `triageItemId` gives every item a uniform tap key
// so the mobile port needs no per-kind hover-reveal branching. All item identity,
// clear, only-you, snooze, and severity flow through these pure helpers, keeping
// the triage zone SSR/test/mobile-portable.
export type ProgressState = 'active' | 'quiet' | 'stalled' | 'wedged' | 'unknown';

export interface SessionSummary {
  project: string;
  session: string;
  progressState: ProgressState;
  paneSeenAt: number;
  updatedAt: number;
  snoozedUntil?: number;
  /** ISO timestamp of the last interpreter summary write (Z7+). */
  summaryUpdatedAt?: number;
  /** Interpreter loop refresh state; 'stale-failing' signals a stuck loop (Z9). */
  refreshState?: 'fresh' | 'stale-failing';
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

/** Stable, kind-uniform id for a triage item. Escalations use their server id;
 *  session items use `${kind}:${project}::${session}`. The single key the store's
 *  optimistic-clear / only-you Sets and the UI tap handlers all key off of. */
export function triageItemId(item: TriageItem): string {
  if (item.kind === 'escalation') return item.escalation.id;
  return `${item.kind}:${item.summary.project}::${item.summary.session}`;
}

/** Effective gate = server stamp OR a local "only you" mark keyed by escalation id.
 *  Z9: local mark lets the operator pin any escalation to the top tier without a
 *  server round-trip. */
export function effectiveOperatorGated(e: Escalation, onlyYouIds?: ReadonlySet<string>): boolean {
  const flag = (e as { operatorGated?: boolean | number }).operatorGated;
  return !!flag || !!onlyYouIds?.has(e.id);
}

export function escalationSeverity(e: Escalation, onlyYouIds?: ReadonlySet<string>): number {
  // `operatorGated` arrives on the wire (0|1) from mapEscalationRow's column
  // spread; the store-slice task declares it on `Escalation`. Read it defensively
  // so this module compiles whether or not that declaration has landed.
  return effectiveOperatorGated(e, onlyYouIds) ? SEV_GATED_OR_WEDGED : SEV_ROUTINE;
}

// Z9: Options bag for selectTriageStack / selectTriageTop (all fields optional →
// existing 3-arg callers and tests remain valid unchanged).
export interface TriageStackOpts {
  /** Items the operator has locally pinned to the top tier ("only you"). */
  onlyYouIds?: ReadonlySet<string>;
  /** Items optimistically cleared (action sent, awaiting server confirm). Excluded. */
  clearedIds?: ReadonlySet<string>;
}

/** Build the merged triage stack. Sorted by severity DESC, then age ASC
 *  (oldest `since` first within a tier). Snoozed and optimistically-cleared
 *  sessions are excluded. Only-you marks promote items to SEV_GATED_OR_WEDGED. */
export function selectTriageStack(
  openEscalations: Escalation[],
  sessionSummaries: Record<string, SessionSummary>,
  now: number,
  opts: TriageStackOpts = {},
): TriageItem[] {
  const { onlyYouIds, clearedIds } = opts;
  const items: TriageItem[] = [];

  for (const e of openEscalations) {
    if (e.status !== 'open') continue;
    const item: TriageItem = { kind: 'escalation', severity: escalationSeverity(e, onlyYouIds), since: e.createdAt, escalation: e };
    if (clearedIds?.has(triageItemId(item))) continue;
    items.push(item);
  }

  for (const s of Object.values(sessionSummaries)) {
    if (s.snoozedUntil && now < s.snoozedUntil) continue; // snoozed → out
    if (s.progressState === 'wedged') {
      const baseSev = SEV_GATED_OR_WEDGED;
      const item: TriageItem = { kind: 'wedge', severity: baseSev, since: s.paneSeenAt, summary: s };
      if (clearedIds?.has(triageItemId(item))) continue;
      items.push(item);
    } else if (s.progressState === 'unknown') {
      const id = `unknown:${s.project}::${s.session}`;
      const sev = onlyYouIds?.has(id) ? SEV_GATED_OR_WEDGED : SEV_UNKNOWN_SOFT;
      const item: TriageItem = { kind: 'unknown', severity: sev, since: s.paneSeenAt, summary: s };
      if (clearedIds?.has(triageItemId(item))) continue;
      items.push(item);
    }
    // active/quiet/stalled do NOT enter the stack — stalled only tints the pill amber.
  }

  return items.sort((a, b) => (b.severity - a.severity) || (a.since - b.since));
}

export function selectTriageTop(
  openEscalations: Escalation[],
  sessionSummaries: Record<string, SessionSummary>,
  now: number,
  opts: TriageStackOpts = {},
): TriageItem | null {
  return selectTriageStack(openEscalations, sessionSummaries, now, opts)[0] ?? null;
}

/** Minutes of no-progress for a wedged/unknown session, for the card label. */
export function wedgeMinutes(summary: SessionSummary, now: number): number {
  return Math.max(0, Math.floor((now - summary.paneSeenAt) / 60_000));
}

// Z9: Optimistic-clear undo model (pure half). The store sends the action and
// reconciles against the server; we provide the timing model and affordance gate.
export const UNDO_WINDOW_MS = 5_000;

export interface PendingClear {
  id: string;          // triageItemId of the cleared item
  label: string;       // "sent → Approve" style toast text (caller-supplied)
  clearedAt: number;   // wall-clock when the optimistic clear fired
}

/** True while the 5s undo affordance should still be offered. */
export function withinUndoWindow(pending: PendingClear, now: number, windowMs = UNDO_WINDOW_MS): boolean {
  return now - pending.clearedAt < windowMs;
}

/** ms remaining on the undo affordance (≥0), for a countdown/auto-dismiss. */
export function undoMsRemaining(pending: PendingClear, now: number, windowMs = UNDO_WINDOW_MS): number {
  return Math.max(0, windowMs - (now - pending.clearedAt));
}

// Z9: Snooze timer pure half. Replaces `Date.now() + 10*60_000` literals in
// ZenMode.tsx with a single canonical constant + helper.
export const DEFAULT_SNOOZE_MS = 10 * 60_000;

/** Absolute deadline for a snooze started at `now`. */
export function snoozeUntil(now: number, ms = DEFAULT_SNOOZE_MS): number {
  return now + ms;
}

/** Earliest FUTURE `snoozedUntil` across all summaries, or null if none pending.
 *  The component arms a single timer for `wakeup - now` to re-surface on expiry —
 *  no per-card polling. */
export function nextSnoozeWakeup(
  summaries: Record<string, SessionSummary>,
  now: number,
): number | null {
  let next: number | null = null;
  for (const s of Object.values(summaries)) {
    if (s.snoozedUntil && s.snoozedUntil > now && (next === null || s.snoozedUntil < next)) {
      next = s.snoozedUntil;
    }
  }
  return next;
}

// Z9: Watchdog threshold input hygiene. Clamps user input before it reaches
// set_watchdog_threshold so the MCP call can't receive a nonsense value.
export const WATCHDOG_THRESHOLD_MIN_MIN = 1;
export const WATCHDOG_THRESHOLD_MAX_MIN = 120;

/** Clamp+round a user-entered wedged-threshold (minutes) before it is sent to
 *  set_watchdog_threshold. NaN/≤0 → MIN; >MAX → MAX. */
export function clampWatchdogThreshold(minutes: number): number {
  if (!Number.isFinite(minutes)) return WATCHDOG_THRESHOLD_MIN_MIN;
  return Math.min(WATCHDOG_THRESHOLD_MAX_MIN, Math.max(WATCHDOG_THRESHOLD_MIN_MIN, Math.round(minutes)));
}

// Z9: Refresh-now force-proof predicate. The REST call lives in the store; we
// provide the pure gate so the "Refresh now" affordance is only shown when meaningful.

/** A summary the operator may want to force-refresh: the loop reported it
 *  stale-failing, OR no interpreter update within `staleMs`. Pure gate for
 *  enabling the "Refresh now" affordance (the REST call lives in the store). */
export function isRefreshable(s: SessionSummary, now: number, staleMs = 2 * 60_000): boolean {
  if (s.refreshState === 'stale-failing') return true;
  const last = s.summaryUpdatedAt ?? 0;
  return last > 0 && now - last >= staleMs;
}
