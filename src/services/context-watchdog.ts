import type { SessionStatusRow } from './session-status-store';
import { CHECKPOINT_READY_MAX_AGE_MS } from './session-status-store';

/**
 * Context-watchdog SELECTOR (pure, deterministic). Decides, per watched session,
 * whether the supervisor should this tick: run a checkpoint, or issue a /clear.
 *
 * Principle (PCS design #6): never auto-compact. At ~80% context, on a SAFE
 * boundary (the session is idle/between-turns, not mid-operation), checkpoint →
 * verify-persisted → /clear → re-setup. This module only answers WHEN/WHAT; the
 * persisted-checkpoint HARD GATE lives in `checkpoint_ready` / `supervisor_clear_session`.
 *
 * All time is injected (`now`) so it is fully unit-testable.
 */

export interface WatchdogConfig {
  /** Context-usage percent at/above which a clear cycle is triggered. */
  thresholdPercent: number;
  /** A contextPercent reading older than this is ignored (stale → don't act). */
  contextMaxAgeMs: number;
  /** A checkpoint marker older than this no longer authorizes a clear. */
  checkpointMaxAgeMs: number;
}

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  thresholdPercent: 80,
  contextMaxAgeMs: 5 * 60 * 1000,
  checkpointMaxAgeMs: CHECKPOINT_READY_MAX_AGE_MS,
};

export type WatchdogAction = 'checkpoint' | 'clear';

export interface WatchdogCandidate {
  session: string;
  action: WatchdogAction;
  contextPercent: number | null;
  reason: string;
  /**
   * True when this candidate IS the supervisor's own session. The supervisor
   * cannot drive itself via supervisor_clear_session (that targets ANOTHER
   * session); a self candidate is handled by the supervisor's own
   * checkpoint→clear→resume branch. Omitted (falsy) for supervised sessions.
   */
  self?: boolean;
}

/**
 * Safe boundary = the session is idle ('waiting'). We never checkpoint a session
 * that is 'active' (mid-operation) or awaiting a 'permission' decision.
 */
function isSafeBoundary(status: SessionStatusRow['status']): boolean {
  return status === 'waiting';
}

export function selectWatchdogActions(
  rows: SessionStatusRow[],
  now: number,
  cfg: WatchdogConfig = DEFAULT_WATCHDOG_CONFIG,
  /** The supervisor's OWN session in this project — its candidate is tagged self. */
  selfSession?: string,
): WatchdogCandidate[] {
  const out: WatchdogCandidate[] = [];
  const tagSelf = (c: WatchdogCandidate): WatchdogCandidate =>
    selfSession != null && c.session === selfSession ? { ...c, self: true } : c;
  for (const r of rows) {
    // 1. A recent persisted checkpoint authorizes a clear NOW, regardless of the
    //    session's current activity status (it already checkpointed at a boundary).
    if (r.checkpointReadyAt != null && now - r.checkpointReadyAt <= cfg.checkpointMaxAgeMs) {
      out.push(tagSelf({ session: r.session, action: 'clear', contextPercent: r.contextPercent, reason: 'checkpoint-persisted' }));
      continue;
    }
    // 2. Over threshold + fresh reading + safe (idle) boundary → checkpoint.
    if (
      r.contextPercent != null &&
      r.contextPercent >= cfg.thresholdPercent &&
      r.contextUpdatedAt != null &&
      now - r.contextUpdatedAt <= cfg.contextMaxAgeMs &&
      isSafeBoundary(r.status)
    ) {
      out.push(tagSelf({ session: r.session, action: 'checkpoint', contextPercent: r.contextPercent, reason: `context>=${cfg.thresholdPercent}@idle` }));
    }
    // else: under threshold, stale reading, or unsafe boundary → wait.
  }
  return out;
}
