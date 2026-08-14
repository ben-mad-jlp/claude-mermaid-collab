/**
 * auto-action-audit.ts — Durable record for auto-acting arms (explore, finding, forge, verify).
 *
 * Single seam for recording autonomous actions that bypass human approval. Writes to
 * supervisor_audit with kind 'auto-action' and enforces that every action names its
 * reason (throw if empty).
 */

import { recordSupervisorAudit } from './supervisor-store.js';
import { getConfig } from './config-service.js';

/** The action that was performed. */
export type AutoActionKind = 'explore-dispatch' | 'finding-filed' | 'mission-forge' | 'verify-explore';

/** The outcome of the action. */
export type AutoActionOutcome = 'performed' | 'refused' | 'capped';

/** The kind string written to supervisor_audit for all auto-action rows. */
export const AUTO_ACTION_AUDIT_KIND = 'auto-action';

/** Session fallback when the caller has no session. */
export const AUTO_ACTION_SESSION = '__auto__';

/**
 * Resolve a named cap from config with a fallback. Returns the fallback if
 * the config value is missing, NaN, zero, or non-positive.
 */
export function resolveCap(key: string, fallback: number): number {
  return Number(getConfig(key, '') || 0) || fallback;
}

/** Max live explore leaves queued under the 'Explore runs' epic. */
export const EXPLORE_QUEUE_MAX = resolveCap('EXPLORE_QUEUE_MAX', 3);

/** Max findings per explore report. */
export const MAX_FINDINGS_PER_REPORT = resolveCap('MAX_FINDINGS_PER_REPORT', 5);

/** Max verify-explore leaves per conductor pass. */
export const MAX_VERIFY_EXPLORES_PER_PASS = resolveCap('MAX_VERIFY_EXPLORES_PER_PASS', 1);

/**
 * Record an autonomous action to the durable audit trail.
 *
 * @throws if reason is empty or whitespace-only (nothing is written)
 */
export function recordAutoAction(input: {
  project: string;
  action: AutoActionKind;
  outcome: AutoActionOutcome;
  reason: string;
  session?: string;
  detail?: Record<string, unknown>;
}): void {
  // Validate FIRST, before any DB touch.
  if (typeof input.reason !== 'string' || input.reason.trim() === '') {
    throw new Error(`recordAutoAction: action '${input.action}' requires a non-empty reason`);
  }

  // Delegate to recordSupervisorAudit. Spread order: action/outcome/reason first,
  // then caller-supplied detail (so it can override deliberately).
  recordSupervisorAudit({
    kind: AUTO_ACTION_AUDIT_KIND,
    project: input.project,
    session: input.session ?? AUTO_ACTION_SESSION,
    detail: JSON.stringify({
      action: input.action,
      outcome: input.outcome,
      reason: input.reason,
      ...(input.detail ?? {}),
    }),
  });
}
