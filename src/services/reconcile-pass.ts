/**
 * Deterministic (no-LLM) reconcile pass for the Orchestrator daemon.
 *
 * Design: design-unified-orchestrator-daemon, decision f0ec0b06.
 * This module replaces the ex-Supervisor reconcile loop with a pure, mechanical
 * pass that the Orchestrator calls for a project at level >= nudge.
 *
 * What it does:
 *   1. STALE ESCALATIONS: Auto-close open escalations whose age exceeds
 *      SUPERVISOR_STALE_AFTER_MS.
 *   2. EPIC-ROLLUP SWEEP + self-healing land-surface.
 *   3. VERIFIED-DONE: auto-close open escalations whose linked todo has
 *      terminally settled out-of-band (done+accepted → verified-done, or
 *      dropped → moot). Deterministic proof gate; a done-but-unaccepted todo is
 *      left alone.
 *
 * (The legacy tmux-NUDGE pass was removed in epic 4b81ca59 / L3: it sent
 * "you have ready work, continue" keystrokes into a worker's tmux session, which
 * is dead in the headless leaf-executor world — workers have no interactive tmux
 * to nudge. The stale-close + land-surface below are the surviving useful work,
 * now running at level `on`.)
 *
 * Pure deterministic — NO LLM/Grok calls. Fail-open: per-item errors never abort
 * the full pass.
 */

import {
  listOpenEscalations,
  resolveEscalation,
  getEscalation,
  recordSupervisorAudit,
  SUPERVISOR_STALE_AFTER_MS,
} from './supervisor-store.ts';
import { getTodo, sweepEpicRollups } from './todo-store.ts';
import { surfaceEpicLand, sweepStrandedAccepted, sweepStrandedEpics, sweepCorruptEpics, releaseDroppedEpicWorktrees, BP0_STRANDED_SUMMARY_KIND, autoLandArmedMissionEpics } from './coordinator-live.ts';
import { assertClaimInvariants } from './invariant-check.ts';

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run one deterministic reconcile pass for the given project.
 * Called by the Orchestrator daemon at level `on` and above.
 */
export async function runReconcilePass(project: string): Promise<void> {
  const now = Date.now();

  // -------------------------------------------------------------------------
  // 1. STALE ESCALATIONS: auto-close open escalations older than the stale window
  // -------------------------------------------------------------------------
  const openEscalations = listOpenEscalations().filter((e) => e.project === project);

  for (const esc of openEscalations) {
    try {
      // BP0 stranded-accept SUMMARY cards are durable + throttled (re-created at
      // most once/hour). Aging one out after the ~60s stale window would close it
      // seconds after creation and the throttle would block re-creation for an
      // hour — making the human-facing card effectively invisible. It clears only
      // when a human resolves it (or the underlying strands are re-integrated), so
      // exempt it from the stale sweep, same as the step-4 auto-close exclusion.
      if (esc.kind === BP0_STRANDED_SUMMARY_KIND) continue;
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
  // 3c. MISSION AUTO-LAND (armed): a mission epic whose BUILD leaves are all
  // green but whose [LAND] leaf is still unapproved can never roll up (the land
  // leaf is a non-done child), so the rollup-gated land surface never reaches it.
  // This sweep evaluates such epics directly and, on a green build proof,
  // promotes the land leaf so the armed surfaceEpicLand → landEpic path lands it.
  // -------------------------------------------------------------------------
  try {
    await autoLandArmedMissionEpics(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] mission auto-land sweep failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3d. STRANDED-EPIC self-heal: a done+accepted epic still AHEAD of master
  // (rolled up out-of-band, or a land refused-then-cleared) is caught by nothing
  // above — surfaceEpicLand only fires for epics that roll up THIS pass. Re-surface
  // each such epic (idempotent; auto-lands at level 'auto'). Bounded + throttled.
  // -------------------------------------------------------------------------
  try {
    await sweepStrandedEpics(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] stranded-epic sweep failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3e. CORRUPT-EPIC self-heal: a land leaf stamped done while its branch is still
  // ahead>0 is a false stamp — reopen it so the land re-attempts. Best-effort.
  // -------------------------------------------------------------------------
  try {
    await sweepCorruptEpics(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] corrupt-epic sweep failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3f. DROPPED-EPIC worktree release (H6a): a dropped epic's accumulation
  // worktree is dead weight on disk — reclaim the checkout dir but KEEP the
  // branch. A dirty worktree is skipped + friction-noted. Throttled + bounded.
  // -------------------------------------------------------------------------
  try {
    await releaseDroppedEpicWorktrees(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] dropped-epic worktree-release sweep failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3a. S6 INVARIANT-ASSERT (sweep-as-net): assert the new-model structural
  // invariants (claim ⟺ in-flight; no terminal-with-claim; held never holds a
  // live claim; epic-rollup consistency) and ALARM (console.warn + supervisor
  // audit) on any violation. ASSERT-only — NEVER mutates/repairs, and explicitly
  // does NOT rewrite the shadow enum. The old "fix missed fan-outs" job is gone:
  // readiness is derived, so there is nothing to materialize. In steady state
  // this finds nothing. Best-effort; never aborts the pass.
  // -------------------------------------------------------------------------
  try {
    assertClaimInvariants(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] invariant-assert failed for ${project}:`,
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
  // GATED OFF BY DEFAULT (MERMAID_BP0_SWEEP=1 to enable). The e7b3f8cb redesign
  // (one-shot/throttled + SUMMARY escalation + step-4 exclusion) lands here, but we
  // KEEP it opt-in: OI-1's accept-time ancestor gate already prevents NEW strands at
  // the source, so this backlog sweep is lower-value, and the prior incident (2200+
  // escalations from the per-tick flood) means it stays off until verified live.
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
      // BP0 stranded-accept SUMMARY escalations are deliberately excluded: they
      // describe a backlog of done+accepted-but-stranded todos, so the linked
      // todos ARE done+accepted — the verified-done gate below would resolve them,
      // and the next sweep would re-create them (the flood loop). They carry no
      // todoId (so the guard below already skips them); this explicit kind check is
      // the documented second guard.
      if (esc.kind === BP0_STRANDED_SUMMARY_KIND) continue;
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
