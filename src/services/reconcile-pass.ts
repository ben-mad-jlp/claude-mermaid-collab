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
  createEscalation,
  recordSupervisorAudit,
  SUPERVISOR_STALE_AFTER_MS,
} from './supervisor-store.ts';
import { getTodo, listTodos, sweepEpicRollups, sweepTerminalBucketChildren } from './todo-store.ts';
import { surfaceEpicLand, sweepStrandedAccepted, sweepStrandedEpics, sweepCorruptEpics, releaseDroppedEpicWorktrees, BP0_STRANDED_SUMMARY_KIND, autoLandArmedMissionEpics, surfaceBuildGreenNonMissionEpics } from './coordinator-live.ts';
import { assertClaimInvariantsAsync } from './invariant-check.ts';
import { claimReason, danglingDeps } from './claimability.ts';
import { yieldToLoop } from './loop-yield.ts';
import { promoteQueuedMissions } from './mission-store.js';
import { syncMissionSubscription } from './mission-subscription.js';

/** Escalation `kind` reserved for the dangling-dependency sweep (below), mirroring
 *  `BP0_STRANDED_SUMMARY_KIND`'s pattern of a dedicated kind so the sweep's own
 *  auto-close pass can find exactly its own cards without touching any other
 *  escalation kind (e.g. the generic 'blocker'/'verified-done' ones step 4 handles). */
export const DANGLING_DEPS_KIND = 'dangling-deps';

/** Escalation `kind` reserved for the epic-sweep triage escalations raised by
 *  sweepEpicRollups flags ('landed-needs-review' and 'motionless' reasons).
 *  Exempted from the stale-close sweep to prevent the close/recreate flap that
 *  would occur on every tick. Auto-closed by step 4 via todoId linking. */
export const EPIC_SWEEP_TRIAGE_KIND = 'epic-sweep-triage';

// ---------------------------------------------------------------------------
// Throttle (mission c4eb4fcc, Phase 3): keep the reconcile pass OFF the every-tick
// (~30s) cadence.
//
// runReconcilePass is a reconciliation/hygiene catch-up: it re-scans the whole
// todos table (`listTodos(project, { includeCompleted: true })`) once per sweep —
// epic-rollup, mission auto-land, non-mission land-surface, stranded-epic,
// dropped-epic worktree release, bucket-hygiene, invariant-assert — so on the 8MB
// self-project DB it drives ~5-6 synchronous full-table `.all()` scans (each
// ~26-130ms) EVERY tick. Those scans, not any one monolith, are the distributed
// block that keeps the shared HTTP event loop starved after Phase 1/2. None of this
// work needs 30s freshness: the real-time cases are handled by the event-driven
// paths (completeTodo's rollup, kickOrchestrator's claim). The sweeps here are
// idempotent self-healing catch-ups, correct to run at a coarser cadence.
//
// So gate the whole pass to run at most once per RECONCILE_INTERVAL_MS per project
// (same proven shape as leaf-worktree-reaper's WORKTREE_GC_INTERVAL_MS and
// session-registry's SESSION_BACKFILL_INTERVAL_MS). This removes ~4/5 of the
// per-tick reconcile scans from the loop without touching the responsive
// ready-todo CLAIM path (runBuildPass / kickOrchestrator), which stays every-tick.
// ---------------------------------------------------------------------------

/** Minimum spacing between reconcile passes for a single project. Hygiene cadence,
 *  not real-time — the event-driven paths handle latency-sensitive work. */
export const RECONCILE_INTERVAL_MS = 150_000; // 2.5 min

const lastReconcileMs = new Map<string, number>();

/**
 * Throttle gate for runReconcilePass. Returns true (and records `now` as the last
 * run) when the pass is due for `project`; false when a previous run is still within
 * RECONCILE_INTERVAL_MS. First call for a project always runs. `now` is injectable
 * for deterministic tests.
 */
export function shouldRunReconcilePass(project: string, now: number = Date.now()): boolean {
  const last = lastReconcileMs.get(project);
  if (last !== undefined && now - last < RECONCILE_INTERVAL_MS) return false;
  lastReconcileMs.set(project, now);
  return true;
}

/** Test seam: clear the per-project throttle clock (all projects, or one). */
export function _resetReconcileThrottle(project?: string): void {
  if (project === undefined) lastReconcileMs.clear();
  else lastReconcileMs.delete(project);
}

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
      // Epic-sweep triage cards are similarly durable and would flap on every tick
      // without exemption — auto-closed by step 4 once their linked epic settles.
      if (esc.kind === BP0_STRANDED_SUMMARY_KIND || esc.kind === EPIC_SWEEP_TRIAGE_KIND) continue;
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
  // Phase 1 (mission c4eb4fcc): cede the HTTP event loop between each independent, idempotent
  // sweep below. Every sweep does synchronous bun:sqlite/fs work inline; without a yield between
  // them the whole reconcile pass holds the loop for its full duration. The sweeps are independent
  // and order-preserved — inserting a macrotask boundary between them changes nothing but WHEN
  // pending HTTP callbacks get to run.
  await yieldToLoop();
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

      if (f.reason === 'landed-needs-review' || f.reason === 'motionless') {
        const epicShortId = f.epicId.slice(0, 8);
        const questionText =
          f.reason === 'landed-needs-review'
            ? `Epic "${epicShortId}" has landed but contains done-but-unaccepted children that need review before closure.`
            : `Epic "${epicShortId}" has children that have been idle past the sweep threshold and need attention.`;

        const detailLine =
          f.reason === 'landed-needs-review'
            ? `Total children: ${f.children}, Done but unaccepted: ${f.doneUnaccepted}`
            : `Total children: ${f.children}, In progress: ${f.inProgress}, Idle for: ${f.idleForMs}ms`;

        createEscalation({
          project,
          session: 'coordinator',
          kind: EPIC_SWEEP_TRIAGE_KIND,
          todoId: f.epicId,
          questionText,
          options: [
            {
              id: 'review',
              label: 'Review epic',
              detail: detailLine,
            },
          ],
        });
      }
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
  await yieldToLoop();
  try {
    await autoLandArmedMissionEpics(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] mission auto-land sweep failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3c-bis. NON-MISSION BUILD-GREEN LAND SURFACE (D1, friction 9312cb98): a
  // non-mission epic in the identical build-green/land-leaf-open shape as 3c is
  // invisible to that sweep (mission-filtered) and can never roll up on its own
  // (land leaf is a non-done child) — it strands looking done forever. Raise the
  // same human land card; never auto-land (surfaceEpicLand's own authority gate
  // refuses non-mission epics — constraint 55ee9d79).
  // -------------------------------------------------------------------------
  await yieldToLoop();
  try {
    await surfaceBuildGreenNonMissionEpics(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] non-mission build-green land surface failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3d. STRANDED-EPIC self-heal: a done+accepted epic still AHEAD of master
  // (rolled up out-of-band, or a land refused-then-cleared) is caught by nothing
  // above — surfaceEpicLand only fires for epics that roll up THIS pass. Re-surface
  // each such epic (idempotent; auto-lands at level 'auto'). Bounded + throttled.
  // -------------------------------------------------------------------------
  await yieldToLoop();
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
  await yieldToLoop();
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
  await yieldToLoop();
  try {
    await releaseDroppedEpicWorktrees(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] dropped-epic worktree-release sweep failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3g. BUCKET HYGIENE SWEEP: archive (status→'dropped') bucket children that are
  // `done` and older than 7 days. Idempotent; only 'done' rows are selected.
  // -------------------------------------------------------------------------
  await yieldToLoop();
  try {
    await sweepTerminalBucketChildren(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] bucket-hygiene sweep failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3h. QUEUED-MISSION PROMOTION SWEEP: for any session with no active
  // non-terminal mission, promote the lowest-queuePos approved queued
  // candidate. Deterministic, DB-only, idempotent by construction.
  // -------------------------------------------------------------------------
  await yieldToLoop();
  try {
    const promoted = promoteQueuedMissions(project);
    for (const missionId of promoted) {
      try {
        syncMissionSubscription(project, missionId);
      } catch {
        /* fail-open, per mission-subscription.ts's own idempotent contract */
      }
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: 'coordinator',
        detail: JSON.stringify({ source: 'reconcile-pass', missionId, reason: 'queued-mission-promoted' }),
      });
    }
  } catch (err) {
    console.warn(
      `[reconcile-pass] queued-mission promotion failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3i. DANGLING-DEPENDENCY SWEEP (surfacing half of claimability.ts's dangling-dep
  // handling): `depSatisfied`/`claimReason` deliberately treat a `dependsOn` id that
  // resolves to NOTHING (typo'd id, a since-deleted todo, or an ambiguous short-id
  // prefix — see `resolveDepId`/`danglingDeps`, claimability.ts) as merely
  // 'deps-pending' — safe, but silent: the dependent parks forever with no signal of
  // WHY. This sweep is the surfacing half: for every non-terminal todo whose
  // claimReason is 'deps-pending' AND which has at least one dangling dep, raise ONE
  // human 'dangling-deps'-kind escalation naming the todo + the dangling id(s)
  // (missing vs ambiguous — different fixes). Dedup is the same stable-questionText
  // discipline used throughout coordinator-live.ts: createEscalation collapses repeat
  // calls to ONE open card per (project,session,questionText) as long as the text is
  // built ONLY from stable facts (no per-run token/count), so a still-dangling dep
  // does not re-raise every ~150s tick. Auto-close mirrors step 4 below: once the dep
  // resolves (edge fixed) OR the todo itself goes terminal, the card is moot.
  // -------------------------------------------------------------------------
  await yieldToLoop();
  try {
    const allTodos = listTodos(project, { includeCompleted: true });
    const byId = new Map(allTodos.map((t) => [t.id, t]));

    for (const t of allTodos) {
      if (t.status === 'done' || t.status === 'dropped') continue;
      if (claimReason(t, byId) !== 'deps-pending') continue;
      const dangling = danglingDeps(t, byId);
      if (dangling.length === 0) continue;

      const shortId = t.id.slice(0, 8);
      const depList = dangling
        .map((d) => `${d.depId} (${d.ambiguous ? 'ambiguous — matches 2+ todos by short-id prefix' : 'missing — no such todo'})`)
        .join(', ');
      createEscalation({
        project,
        session: 'coordinator',
        kind: DANGLING_DEPS_KIND,
        todoId: t.id,
        questionText:
          `Todo "${t.title ?? shortId}" (${shortId}) is parked deps-pending indefinitely: dependsOn references ` +
          `${dangling.length} dangling id(s) that resolve to no todo: ${depList}. Fix: re-point or remove the bad ` +
          `dependsOn id(s) (edit the todo's deps), or drop this todo if it's no longer needed.`,
      });
    }

    // Auto-close: a 'dangling-deps' card whose todo has since gone terminal, or whose
    // dependsOn no longer has ANY dangling id (the edge was fixed / the ambiguity
    // resolved), is moot.
    const openDangling = listOpenEscalations().filter((e) => e.project === project && e.kind === DANGLING_DEPS_KIND);
    for (const esc of openDangling) {
      try {
        if (!esc.todoId) continue;
        if (getEscalation(esc.id)?.status !== 'open') continue;
        const todo = byId.get(esc.todoId) ?? getTodo(project, esc.todoId);
        if (!todo) continue; // todo itself gone — leave for the stale sweep to age it out
        const terminal = todo.status === 'done' || todo.status === 'dropped';
        const stillDangling = !terminal && danglingDeps(todo, byId).length > 0;
        if (terminal || !stillDangling) {
          resolveEscalation(esc.id, 'resolved', 'ai');
          recordSupervisorAudit({
            kind: 'reconcile',
            project,
            session: 'coordinator',
            detail: JSON.stringify({
              source: 'reconcile-pass',
              escalationId: esc.id,
              todoId: esc.todoId,
              reason: terminal ? 'todo-terminal' : 'dangling-dep-resolved',
            }),
          });
        }
      } catch (err) {
        console.warn(
          `[reconcile-pass] dangling-deps auto-close failed for ${esc.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[reconcile-pass] dangling-dependency sweep failed for ${project}:`,
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
  // Phase 2 (mission c4eb4fcc): the invariant scan is QUERY-bound — listTodos' single
  // synchronous bun:sqlite `.all()` over the whole todos table is the monolith (~85% of
  // the cost). assertClaimInvariantsAsync CHUNKS that read (keyset pagination + a yield
  // between pages) so it no longer starves the HTTP loop for its whole duration. Chunked
  // on the SAME (already-migrated) connection — NOT a separate-connection worker, whose
  // fresh openDb backfill would heal-and-mask the very claim invariants this pass surfaces.
  // Fail-open: a chunked-read error falls back to the inline scan inside the async fn.
  await yieldToLoop();
  try {
    await assertClaimInvariantsAsync(project);
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
  await yieldToLoop();
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
  await yieldToLoop();
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
