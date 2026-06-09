/**
 * Deterministic (no-LLM) reconcile pass for the Orchestrator daemon.
 *
 * Design: design-unified-orchestrator-daemon, decision f0ec0b06.
 * This module replaces the ex-Supervisor reconcile loop with a pure, mechanical
 * pass that the Orchestrator calls for a project at level >= nudge.
 *
 * What it does (Phase 1):
 *   1. NUDGE: For each supervised session in the project that is IDLE and owns at
 *      least one `ready` todo, send a nudge via tmux. Rate-limited per session
 *      (module-level Map, 5-minute cooldown).
 *   2. STALE ESCALATIONS: Auto-close open escalations whose age exceeds
 *      SUPERVISOR_STALE_AFTER_MS.
 *   3. VERIFIED-DONE: TODO (Phase 2) — auto-close escalations that are
 *      verified-done (todo terminal, escalation still open). Not implemented yet;
 *      requires a deterministic proof gate. Left as a placeholder.
 *
 * Pure deterministic — NO LLM/Grok calls. Fail-open: per-session errors never
 * abort the full pass.
 */

import {
  listSupervised,
  listOpenEscalations,
  resolveEscalation,
  recordSupervisorAudit,
  SUPERVISOR_STALE_AFTER_MS,
  getSupervisedLaunchProject,
} from './supervisor-store.ts';
import { listTodos, sweepEpicRollups } from './todo-store.ts';
import { sendTmuxKeys } from './tmux-send.ts';
import { getStatus } from './session-status-store.ts';
import { deriveLiveness } from './session-runtime.ts';

// ---------------------------------------------------------------------------
// Rate-limit state (module-level, survives the process lifetime)
// ---------------------------------------------------------------------------

/** Nudge cooldown: do not re-nudge a session within this window. */
export const NUDGE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** module-level last-nudge-time per session (key = `${project}::${session}`). */
const lastNudgeAt = new Map<string, number>();

/** Exported for tests: reset the rate-limit map. */
export function _resetNudgeState(): void {
  lastNudgeAt.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when the session's status indicates it is IDLE (not actively running a turn). */
function isSessionIdle(project: string, session: string, now: number): boolean {
  const status = getStatus(project, session);
  if (!status) {
    // No status row → session never registered or already gone — treat as idle
    // so a dangling supervised session doesn't silently block nudges.
    return true;
  }
  // hasActiveClaim is unknown here without a full join; use false (safe: only
  // flips crashed→idle, which is acceptable — a crashed session still gets a nudge).
  const liveness = deriveLiveness(status, false, now);
  return liveness === 'idle';
}

/** True when a session has at least one `ready` todo it OWNS or is assigned to. */
function hasReadyWork(project: string, session: string): boolean {
  // Check todos owned by this session
  const owned = listTodos(project, { ownerSession: session, status: 'ready' });
  if (owned.length > 0) return true;
  // Check todos assigned to this session
  const assigned = listTodos(project, { assigneeSession: session, status: 'ready' });
  return assigned.length > 0;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run one deterministic reconcile pass for the given project.
 * Called by the Orchestrator daemon at level >= nudge.
 */
export async function runReconcilePass(project: string): Promise<void> {
  const now = Date.now();

  // -------------------------------------------------------------------------
  // 1. NUDGE: idle sessions with ready work
  // -------------------------------------------------------------------------
  const supervised = listSupervised().filter((s) => s.project === project);

  for (const sup of supervised) {
    try {
      const { session } = sup;

      if (!isSessionIdle(project, session, now)) continue;
      if (!hasReadyWork(project, session)) continue;

      // Rate-limit check
      const key = `${project}::${session}`;
      const lastNudge = lastNudgeAt.get(key) ?? 0;
      if (now - lastNudge < NUDGE_COOLDOWN_MS) continue;

      // Derive the tmux launch project (cross-project coordinator spawn fix)
      const launchProject = getSupervisedLaunchProject(project, session) ?? project;

      const nudgeText =
        'You have ready work in the task graph. Please check your todos and continue.';

      await sendTmuxKeys(launchProject, session, nudgeText);

      lastNudgeAt.set(key, now);

      recordSupervisorAudit({
        kind: 'nudge',
        project,
        session,
        detail: JSON.stringify({ source: 'reconcile-pass', launchProject }),
      });
    } catch (err) {
      // Fail-open: log but do not abort the pass for other sessions.
      console.warn(
        `[reconcile-pass] nudge failed for ${project}/${sup.session}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. STALE ESCALATIONS: auto-close open escalations older than the stale window
  // -------------------------------------------------------------------------
  const openEscalations = listOpenEscalations().filter((e) => e.project === project);

  for (const esc of openEscalations) {
    try {
      const age = now - esc.createdAt;
      if (age < SUPERVISOR_STALE_AFTER_MS) continue;

      resolveEscalation(esc.id, 'stale');

      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: esc.session,
        detail: JSON.stringify({
          source: 'reconcile-pass',
          escalationId: esc.id,
          ageMs: age,
          reason: 'stale',
        }),
      });
    } catch (err) {
      console.warn(
        `[reconcile-pass] stale-escalation close failed for ${esc.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 3. EPIC-ROLLUP SWEEP: close epics whose children all settled out-of-band.
  //
  // The event-driven rollup in completeTodo only fires when a child completes
  // through that path. An epic whose children settled outside it (legacy
  // completions, bulk edits, cross-session) stays in_progress forever. This
  // sweep is the periodic catch-up: roll up epics whose non-dropped children are
  // ALL done+accepted; leave (and flag) epics with done-but-unaccepted children
  // so ungated work is never silently closed. It raises NO escalations or land
  // cards — the 'epic-ready-to-land' surface stays on the event path only.
  // -------------------------------------------------------------------------
  try {
    const { rolledUp, flagged } = await sweepEpicRollups(project);
    for (const epicId of rolledUp) {
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: 'coordinator',
        detail: JSON.stringify({ source: 'reconcile-pass', epicId, rolledUp: true, reason: 'epic-children-all-done-accepted' }),
      });
    }
    for (const f of flagged) {
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: 'coordinator',
        detail: JSON.stringify({ source: 'reconcile-pass', epicId: f.epicId, flag: 'epic-all-done-but-unaccepted', children: f.children, unaccepted: f.unaccepted }),
      });
    }
  } catch (err) {
    console.warn(
      `[reconcile-pass] epic-rollup sweep failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 4. VERIFIED-DONE (Phase 2 — NOT YET IMPLEMENTED)
  //
  // TODO(Phase 2): For each open escalation whose linked todoId is in a
  // terminal state (done / dropped / accepted), auto-close with status
  // 'resolved' and record a 'reconcile' audit. This requires a deterministic
  // proof gate (the escalation must carry a valid proof string referencing the
  // completed todo) before auto-closure is safe. Deferred to Phase 2.
  // -------------------------------------------------------------------------
}
