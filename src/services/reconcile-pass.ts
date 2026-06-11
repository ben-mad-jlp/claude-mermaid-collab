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
 *   3. VERIFIED-DONE: auto-close open escalations whose linked todo has
 *      terminally settled out-of-band (done+accepted → verified-done, or
 *      dropped → moot). Deterministic proof gate; a done-but-unaccepted todo is
 *      left alone.
 *
 * Pure deterministic — NO LLM/Grok calls. Fail-open: per-session errors never
 * abort the full pass.
 */

import {
  listSupervised,
  listOpenEscalations,
  resolveEscalation,
  getEscalation,
  recordSupervisorAudit,
  SUPERVISOR_STALE_AFTER_MS,
  getSupervisedLaunchProject,
} from './supervisor-store.ts';
import { listTodos, getTodo, sweepEpicRollups } from './todo-store.ts';
import { surfaceEpicLand, sweepStrandedAccepted } from './coordinator-live.ts';
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

      resolveEscalation(esc.id, 'stale', 'ai');

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
  // so ungated work is never silently closed.
  //
  // SELF-HEALING LAND SURFACE (design-epic-landing P2): for each epic rolled up
  // HERE (out-of-band — completeTodo's event path never fired), call the SAME
  // surfaceEpicLand the event path uses. It raises a deduped 'epic-ready-to-land'
  // card every tick until landed (so stranded work can't hide), and at level>=drive
  // auto-lands a green epic via the existing safe landEpic path. This lifts the old
  // mute that left rolled-up epics silent — the exact gap behind the incident.
  // -------------------------------------------------------------------------
  try {
    const { rolledUp, flagged } = await sweepEpicRollups(project);
    for (const epicId of rolledUp) {
      await surfaceEpicLand(project, epicId, { sessionHint: 'coordinator' });
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
  // 3b. BP0 STRANDED-ACCEPT REPAIR: detect todos that are done+accepted but whose
  // work never reached their epic branch (commit stranded on a lane branch, or
  // accepted with NO commit at all — the phantom-done incident). The acceptance
  // gate now blocks this going forward, but pre-existing damage (and any lane
  // whose merge-back silently no-op'd) lingers invisibly: acceptanceStatus says
  // "landed" while the epic branch is missing the work, so land_epic would
  // (correctly) refuse to land it. This periodic sweep is the catch-up — it raises
  // one escalation per stranded accepted todo so a human re-integrates or re-opens
  // it. Read-only w.r.t. the work-graph (it flags; it does not silently re-open a
  // human-visible acceptance). Best-effort; never aborts the pass.
  // -------------------------------------------------------------------------
  // GATED OFF BY DEFAULT (MERMAID_BP0_SWEEP=1 to enable). This per-tick sweep
  // FLOODS: it flags every already-accepted todo whose work isn't on the epic
  // branch, but step 4 below auto-closes that escalation the same/next tick
  // (the linked todo IS done+accepted → "settled"), so it re-fires every 30s —
  // 2000+ escalations across projects in minutes. The forward-prevention (the
  // acceptance gate verifying the commit reached the branch) does the real work;
  // this BACKLOG repair must be a throttled one-shot with a SUMMARY escalation +
  // exclusion from the step-4 auto-close, not a per-tick generator. Until that
  // redesign lands it stays opt-in so it can never flood the inbox.
  if (process.env.MERMAID_BP0_SWEEP === '1') {
    try {
      const flagged = await sweepStrandedAccepted(project);
      if (flagged.length > 0) {
        recordSupervisorAudit({
          kind: 'reconcile',
          project,
          session: 'coordinator',
          detail: JSON.stringify({ source: 'reconcile-pass', bp0: 'stranded-accept-sweep', flagged }),
        });
      }
    } catch (err) {
      console.warn(
        `[reconcile-pass] stranded-accept sweep failed for ${project}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 4. VERIFIED-DONE: auto-close open escalations whose linked todo has
  //    terminally settled out-of-band.
  //
  // An escalation carries a `todoId` link (escalations filed by the coordinator
  // / worker reference the todo they blocked on). The event path
  // (resolveEscalationsForTodo, fired from completeTodo) closes these the moment
  // the todo completes through that path — but a todo that settled out-of-band
  // (legacy completion, bulk edit, cross-session, or a drop) never fires that
  // event, stranding its escalation open forever. This sweep is the periodic
  // catch-up.
  //
  // The deterministic proof gate (no LLM): the linked todo must be in a terminal
  // state that makes the escalation moot —
  //   • done + acceptanceStatus==='accepted'  → gate-verified-done (work passed
  //       the mechanical gate; any blocker on it is resolved).
  //   • dropped                                → work abandoned; the blocker is moot.
  // A todo that is done but NOT accepted (pending/rejected) is deliberately left
  // alone: the work has not passed the gate, so its escalation may still be live.
  // -------------------------------------------------------------------------
  for (const esc of openEscalations) {
    try {
      if (!esc.todoId) continue;
      // The openEscalations snapshot predates the stale-close loop above; skip
      // any escalation it already closed so we don't clobber its 'stale' status.
      if (getEscalation(esc.id)?.status !== 'open') continue;
      const todo = getTodo(project, esc.todoId);
      if (!todo) continue;

      const verifiedDone = todo.status === 'done' && todo.acceptanceStatus === 'accepted';
      const dropped = todo.status === 'dropped';
      if (!verifiedDone && !dropped) continue;

      resolveEscalation(esc.id, 'resolved', 'ai');

      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: esc.session,
        detail: JSON.stringify({
          source: 'reconcile-pass',
          escalationId: esc.id,
          todoId: esc.todoId,
          reason: verifiedDone ? 'verified-done' : 'todo-dropped',
        }),
      });
    } catch (err) {
      console.warn(
        `[reconcile-pass] verified-done close failed for ${esc.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
