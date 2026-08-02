/**
 * conductor-kill-rate.ts — the conductor exit-code monitor.
 *
 * Reads the conductor kill rate (timed-out nodes / total conductor nodes) over a rolling
 * window and, when it exceeds the baseline, raises ONE deduped operator-gated escalation
 * naming the rate. This is a slow exit check (6h+ cadence), fired as a fail-open side effect
 * in the conductor pass, independent of the mission-serving logic.
 */

import { conductorKillCounts } from './worker-ledger.js';
import { createEscalation, type Escalation } from './supervisor-store.js';

/** Pre-fix (2026-07-30) kill rate: 75 kills / 874 total = 8.6% over 14 days. */
export const CONDUCTOR_KILL_RATE_BASELINE = {
  killed: 75,
  total: 874,
  rate: 0.086,
  windowDays: 14,
  windowEndDate: '2026-07-30',
};

/** 7-day window for the fresh kill-rate check (the "fresh 7-day window" the constitution names). */
export const CONDUCTOR_KILL_RATE_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** Floor below which a rate is too noisy to card (a fresh-deploy window with 3 total calls must not fire). */
export const CONDUCTOR_KILL_RATE_MIN_SAMPLE = 30;

/** Source label for conductor rows in the worker ledger. */
export const CONDUCTOR_KILL_RATE_SOURCE = 'conductor';

/** Throttle cadence — at most once per interval per project (slow exit check). */
export const CONDUCTOR_KILL_RATE_INTERVAL_MS = 6 * 60 * 60_000; // 6h

/** Escalation kind for a high conductor kill rate. */
export const CONDUCTOR_KILL_RATE_KIND = 'conductor-kill-rate';

/** Stable per-rate marker embedded in the card text so the dedup can match it. */
export function conductorKillRateMarker(): string {
  return '[conductor-kill-rate]';
}

const lastRun = new Map<string, number>();

/** Throttle gate — at most once per CONDUCTOR_KILL_RATE_INTERVAL_MS per project. First call always runs. */
export function shouldRunConductorKillRateArm(project: string, now: number = Date.now()): boolean {
  const last = lastRun.get(project);
  if (last !== undefined && now - last < CONDUCTOR_KILL_RATE_INTERVAL_MS) return false;
  lastRun.set(project, now);
  return true;
}

/** Test seam: clear the throttle clock. */
export function _resetConductorKillRateThrottle(): void {
  lastRun.clear();
}

export interface ConductorKillRateResult {
  killed: number;
  total: number;
  rate: number;
  windowMs: number;
}

/**
 * Read the conductor kill rate over a window. Returns { killed, total, rate, windowMs }.
 * This is GLOBAL (no project filter) — the baseline it's compared to is fleet-wide.
 */
export function conductorKillRate(
  { windowMs = CONDUCTOR_KILL_RATE_WINDOW_MS, now = Date.now() } = {},
): ConductorKillRateResult {
  const counts = conductorKillCounts({ source: CONDUCTOR_KILL_RATE_SOURCE, sinceMs: now - windowMs });
  return {
    killed: counts.killed,
    total: counts.total,
    rate: counts.total > 0 ? counts.killed / counts.total : 0,
    windowMs,
  };
}

export interface ConductorKillRateArmDeps {
  now?: () => number;
  killRate?: typeof conductorKillRate;
  createEscalation?: typeof createEscalation;
}

/**
 * One conductor kill-rate exit check pass for a project. Flags high rates with a deduped
 * operator-gated escalation. Best-effort; never throws.
 */
export async function runConductorKillRateArm(
  project: string,
  deps: ConductorKillRateArmDeps = {},
): Promise<{ cardRaised: boolean }> {
  const now = (deps.now ?? Date.now)();
  const killRate = deps.killRate ?? conductorKillRate;
  const createEsc = deps.createEscalation ?? createEscalation;

  try {
    const rate = killRate({ now });

    // Too few samples — noisy signal, no card.
    if (rate.total < CONDUCTOR_KILL_RATE_MIN_SAMPLE) {
      return { cardRaised: false };
    }

    // Below baseline — no alarm. Baseline is 8.6%, so 0% or 5% is fine; 10%+ is concerning.
    if (rate.rate <= CONDUCTOR_KILL_RATE_BASELINE.rate) {
      return { cardRaised: false };
    }

    // Above baseline — raise card with stable text so createEscalation's conditionKey dedup
    // collapses repeated windows into one open card (updates recurrence count instead of creating new).
    const result = await createEsc({
      project,
      session: '__conductor_kill_rate__',
      kind: CONDUCTOR_KILL_RATE_KIND,
      operatorGated: true,
      audience: 'human' as const,
      conditionKey: 'conductor-kill-rate',
      questionText:
        `${conductorKillRateMarker()} Conductor kill rate: ${(rate.rate * 100).toFixed(1)}% ` +
        `(${rate.killed}/${rate.total} killed in last ${Math.round(rate.windowMs / (24 * 60 * 60_000))} days) ` +
        `vs baseline ${(CONDUCTOR_KILL_RATE_BASELINE.rate * 100).toFixed(1)}% ` +
        `(${CONDUCTOR_KILL_RATE_BASELINE.killed}/${CONDUCTOR_KILL_RATE_BASELINE.total} on ${CONDUCTOR_KILL_RATE_BASELINE.windowEndDate}). ` +
        `Node timeouts may indicate unsustainable serve-states or insufficient wall-clock budgets. ` +
        `Check orchestrator_status for recent serves and conductor_passes for timeout patterns.`,
      todoId: null,
    });

    return { cardRaised: result.isNew };
  } catch {
    // fail-open — the kill-rate check must never break a conductor pass
    return { cardRaised: false };
  }
}
