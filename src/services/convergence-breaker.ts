/**
 * Convergence-breaker SELECTOR — P1: per-lane budget / iteration / wall-clock caps.
 * (EPIC 01a1359f, child 87452094.)
 *
 * Pure, deterministic, time-injected machinery — mirrors `selectWatchdogActions`
 * (context-watchdog.ts). The user steer is load-bearing: "machinery is deterministic,
 * LLMs are not." This module decides, from OBSERVABLE telemetry alone (no agent
 * cooperation, no LLM judgment, NO synthesized metric), whether a lane has burned a
 * HARD cap and must be parked+escalated, or crossed a SOFT cap and should be warned.
 *
 * P1 SCOPE: budget caps trip ALONE — there is no convergence/metric AND-gate here
 * (that is P2+). A lane running past a hard iteration/wall-clock/token ceiling is
 * pathological at any trend, so a single hard breach trips. This guarantees nothing
 * runs forever. The HARD INVARIANT (never fabricate a metric for a run that didn't
 * declare one) is honored trivially: this module reads only counts/time/tokens.
 *
 * All time is injected (`now`) so it is fully unit-testable.
 */

/** Observable per-lane telemetry, read as a side-effect of the lane running. */
export interface LaneBudgetRow {
  todoId: string;
  /** Human label for the escalation/notification payload. */
  title?: string;
  /** Persisted lane session (null ⇒ not a real spawned worker → skip). */
  session?: string | null;
  /** Lane start, epoch ms (todo.claimedAt). NaN/undefined ⇒ wall-clock unknown → skip that axis. */
  claimedAtMs?: number;
  /** Dispatch/retry count for this lane (attempts). */
  iterations?: number;
  /** Tokens spent on this lane so far (input+output), from worker_phase.usage telemetry. */
  tokensSpent?: number;
}

/** A single cap with a soft (warn/arm) and hard (trip) tier. A tier set to null disables it. */
export interface CapTier {
  soft: number | null;
  hard: number | null;
}

export interface ConvergenceBudgetConfig {
  iterations: CapTier;
  wallClockMs: CapTier;
  tokens: CapTier;
}

/**
 * Conservative defaults — chosen to NEVER stop slow-but-real work, only to kill the
 * genuine runaway. Tunable per-project (set_convergence_budget → watched_project cols).
 * Premature-stop is the #1 risk (it trains humans to disable the breaker), so defaults
 * sit high; a project that wants tighter caps lowers them deliberately.
 */
export const DEFAULT_BUDGET_CONFIG: ConvergenceBudgetConfig = {
  iterations: { soft: 8, hard: 15 },
  wallClockMs: { soft: 30 * 60 * 1000, hard: 90 * 60 * 1000 },
  tokens: { soft: 1_500_000, hard: 4_000_000 },
};

export type BudgetTier = 'soft' | 'hard';

/** One cap breach within a lane. */
export interface CapBreach {
  cap: 'iterations' | 'wallClockMs' | 'tokens';
  tier: BudgetTier;
  value: number;
  limit: number;
}

/** A lane that crossed at least one cap. `tier` is the WORST tier breached. */
export interface BudgetTrip {
  todoId: string;
  title?: string;
  session?: string | null;
  /** 'hard' ⇒ park+escalate+notify; 'soft' ⇒ warn/audit only. */
  tier: BudgetTier;
  breaches: CapBreach[];
  /** Human-readable one-liner for the escalation/notification payload. */
  reason: string;
}

function axisBreach(
  cap: CapBreach['cap'],
  value: number | undefined,
  tier: CapTier,
): CapBreach | null {
  if (value == null || !Number.isFinite(value)) return null;
  // Hard takes precedence over soft when both are crossed.
  if (tier.hard != null && value >= tier.hard) {
    return { cap, tier: 'hard', value, limit: tier.hard };
  }
  if (tier.soft != null && value >= tier.soft) {
    return { cap, tier: 'soft', value, limit: tier.soft };
  }
  return null;
}

function fmt(b: CapBreach): string {
  if (b.cap === 'wallClockMs') {
    return `wall-clock ${Math.round(b.value / 60000)}m ≥ ${Math.round(b.limit / 60000)}m`;
  }
  if (b.cap === 'tokens') {
    return `tokens ${Math.round(b.value / 1000)}k ≥ ${Math.round(b.limit / 1000)}k`;
  }
  return `iterations ${b.value} ≥ ${b.limit}`;
}

/**
 * Pure selector: given lane telemetry + caps + now, return the lanes that breached a
 * cap, each tagged with its WORST tier. A lane with no breach is omitted. A lane with
 * no `session` (not a real spawned worker) is skipped — the reaper handles those.
 */
export function selectBudgetTrips(
  rows: LaneBudgetRow[],
  now: number,
  cfg: ConvergenceBudgetConfig = DEFAULT_BUDGET_CONFIG,
): BudgetTrip[] {
  const out: BudgetTrip[] = [];
  for (const r of rows) {
    if (!r.session) continue; // not a real lane → reaper's job, not the breaker's
    const wallMs =
      r.claimedAtMs != null && Number.isFinite(r.claimedAtMs)
        ? now - r.claimedAtMs
        : undefined;
    const breaches = [
      axisBreach('iterations', r.iterations, cfg.iterations),
      axisBreach('wallClockMs', wallMs, cfg.wallClockMs),
      axisBreach('tokens', r.tokensSpent, cfg.tokens),
    ].filter((b): b is CapBreach => b != null);
    if (breaches.length === 0) continue;
    const tier: BudgetTier = breaches.some((b) => b.tier === 'hard') ? 'hard' : 'soft';
    out.push({
      todoId: r.todoId,
      title: r.title,
      session: r.session,
      tier,
      breaches,
      reason: `${tier === 'hard' ? 'HARD' : 'soft'} cap: ${breaches.map(fmt).join(', ')}`,
    });
  }
  return out;
}
