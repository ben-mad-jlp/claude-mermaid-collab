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
import { getTodo, listTodos, sweepEpicRollups, sweepTerminalBucketChildren, reviveTerminalBuckets, type Todo } from './todo-store.ts';
import { surfaceEpicLand, sweepStrandedAccepted, sweepStrandedEpics, sweepCorruptEpics, releaseDroppedEpicWorktrees, BP0_STRANDED_SUMMARY_KIND, autoLandArmedMissionEpics, surfaceBuildGreenNonMissionEpics } from './coordinator-live.ts';
import { assertClaimInvariantsAsync } from './invariant-check.ts';
import { claimReason, danglingDeps, resolveDepId, hasTerminalEpicAncestor } from './claimability.ts';
import { settleDupOfLanded, repointDependents, dependentsOf, DUP_OF_LANDED } from './dep-settlement.ts';
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

/** Escalation `kind` reserved for the dep-strand decision sweep (3j below), mirroring
 *  `DANGLING_DEPS_KIND`'s pattern of a dedicated kind so that sweep's own auto-close
 *  finds exactly its own cards and never touches another kind's. Raised for the
 *  stranding shapes the dep-settlement primitives cannot safely auto-resolve: a
 *  DROPPED leaf whose dependents read 'dep-dropped', and a HELD leaf whose dependents
 *  read 'deps-pending' with no landed sha to settle against. */
export const DEP_STRAND_DECISION_KIND = 'dep-strand-decision';

/** Escalation `kind` reserved for the parentless-leaf sweep: a GRANDFATHERED
 *  `kind:'leaf'` row with no parentId (created before the store's
 *  parentless-leaf-refused guard) is permanently unclaimable and invisible to every
 *  epic-scoped surface (incident b053b529 sat 5+ hours). The sweep raises exactly ONE
 *  deduped human card per orphan — never auto-drops (the row may carry real work a
 *  human should re-home or consciously drop). Exempt from the stale-close sweep like
 *  the other durable kinds. */
export const PARENTLESS_LEAF_KIND = 'parentless-leaf';

/** Grace period before a parentless leaf is carded — a freshly written row mid-repair
 *  (e.g. a re-homing edit in flight) must not flap a card. */
export const PARENTLESS_LEAF_GRACE_MS = 3_600_000; // 1h

/** Deterministic identity for a parentless-leaf card: one card per orphan row —
 *  createEscalation's conditionKey path reuses the open card and honours a resolved
 *  row's suppression, so a second sweep never mints a rival. */
export function parentlessLeafConditionKey(leafId: string): string {
  return `parentless-leaf:${leafId.slice(0, 8)}`;
}

/**
 * Raise one deduped human card per grandfathered parentless leaf older than the grace
 * period. Injectable now/todos/createEscalation for hermetic tests; returns the ids of
 * the leaves for which a NEW card was raised this sweep. Fail-open per row — one bad
 * card write never aborts the sweep.
 */
export function sweepParentlessLeaves(
  project: string,
  opts?: {
    now?: number;
    todos?: Todo[];
    createEscalation?: typeof createEscalation;
    graceMs?: number;
  },
): string[] {
  const now = opts?.now ?? Date.now();
  const graceMs = opts?.graceMs ?? PARENTLESS_LEAF_GRACE_MS;
  const createEsc = opts?.createEscalation ?? createEscalation;
  const todos = opts?.todos ?? listTodos(project, { includeCompleted: true });
  const carded: string[] = [];
  for (const t of todos) {
    try {
      if (t.kind !== 'leaf' || t.parentId != null) continue;
      if (t.status === 'done' || t.status === 'dropped') continue;
      const createdMs = typeof t.createdAt === 'number' ? t.createdAt : new Date(t.createdAt as unknown as string).getTime();
      if (!Number.isFinite(createdMs) || now - createdMs < graceMs) continue;
      const shortId = t.id.slice(0, 8);
      const res = createEsc({
        project,
        session: 'coordinator',
        kind: PARENTLESS_LEAF_KIND,
        todoId: t.id,
        audience: 'human',
        operatorGated: true,
        conditionKey: parentlessLeafConditionKey(t.id),
        conditionTuple: [PARENTLESS_LEAF_KIND, shortId],
        questionText:
          `Leaf "${t.title ?? shortId}" (${shortId}) has NO parent epic or bucket — it is ` +
          `permanently unclaimable and invisible to every epic-scoped surface. It predates the ` +
          `store's parentless-leaf-refused guard (grandfathered). Fix: re-home it under a real ` +
          `epic or bucket (set parentId), or drop it if the work is no longer needed. It will ` +
          `NOT be auto-dropped.`,
      });
      if (res && res.isNew) carded.push(t.id);
    } catch (err) {
      console.warn(
        `[reconcile-pass] parentless-leaf card failed for ${t.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return carded;
}

/** Deterministic identity for a dep-strand escalation: same strander + same dependent
 *  set → same key, so `createEscalation`'s keyed dedup bumps the existing open row
 *  (or honours a resolved row's suppression) instead of minting a rival card. Sorts
 *  `dependentIds` internally so callers cannot pass an unsorted set and mint a rival key. */
export function depStrandConditionKey(stranderId: string, dependentIds: string[]): string {
  return `dep-strand:${stranderId.slice(0, 8)}:${dependentIds.map((i) => i.slice(0, 8)).sort().join(',')}`;
}

/** Format an idle duration in milliseconds to a human-readable string. */
function formatIdleMs(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours === 0) {
    const minutes = Math.round(ms / 60_000);
    return `${minutes}m`;
  }
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

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
  // THE ONE ESCALATION-TABLE READ (audit item 8): this snapshot is the single
  // `listOpenEscalations()` sweep for the whole pass. Steps 1 (stale-reaper),
  // 3i (dangling-deps auto-close), 3j (dep-strand auto-close) and 4
  // (verified-done) are PHASES over it — each re-reads a row's CURRENT status
  // via the cheap keyed `getEscalation(id)` check exactly once before writing,
  // so a row an earlier phase (or a concurrent actor) already resolved is never
  // double-written, while the three duplicate full-table reads are gone.
  // Escalations CREATED mid-pass (3, 3i, 3j card phases) are deliberately not
  // re-enumerated: a just-created card cannot be stale/moot in the same pass,
  // and createEscalation's keyed dedup owns its identity.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 1. STALE ESCALATIONS: auto-close open escalations older than the stale window
  // -------------------------------------------------------------------------
  const openEscalations = listOpenEscalations().filter((e) => e.project === project);

  for (const esc of openEscalations) {
    try {
      // Phase discipline (item 8): skip a row that is no longer open (defensive —
      // step 1 is the first phase, but the snapshot-then-recheck shape is uniform).
      if (getEscalation(esc.id)?.status !== 'open') continue;
      // BP0 stranded-accept SUMMARY cards are durable + throttled (re-created at
      // most once/hour). Aging one out after the ~60s stale window would close it
      // seconds after creation and the throttle would block re-creation for an
      // hour — making the human-facing card effectively invisible. It clears only
      // when a human resolves it (or the underlying strands are re-integrated), so
      // exempt it from the stale sweep, same as the step-4 auto-close exclusion.
      // Epic-sweep triage cards are similarly durable and would flap on every tick
      // without exemption — auto-closed by step 4 once their linked epic settles.
      // Dep-strand decision cards (3j) are durable for the same reason: they dedup on a
      // stable questionText and describe a strand that only a human edge-fix (or the 3j
      // auto-close) clears, so aging one out just re-raises it on the next tick.
      // Parentless-leaf cards (3k) are durable too: they dedup on a per-orphan conditionKey
      // and describe a row only a human re-home/drop clears, so aging one out just
      // re-raises it on the next sweep.
      if (esc.kind === BP0_STRANDED_SUMMARY_KIND || esc.kind === EPIC_SWEEP_TRIAGE_KIND || esc.kind === DEP_STRAND_DECISION_KIND || esc.kind === PARENTLESS_LEAF_KIND) continue;
      const age = now - esc.createdAt;

      // TIMEOUT HONESTY: a card that PRINTS a timeout (expiresAt stamped at create)
      // lives at least until that deadline — the ~60s stale window NEVER applies to it.
      // (The incident: contested-review cards promising "Timeout: 10 minutes" were
      // reaped in 60-180s, so the human tie-breaker effectively did not exist.) Once
      // the promised deadline passes, the card is reaped as a labeled TIMEOUT DEFAULT,
      // not as an anonymous 'ai' close: resolvedBy='timeout-default' + a durable
      // resolutionNote so audits can find every human call overridden by silence.
      if (esc.expiresAt != null) {
        if (now < esc.expiresAt) continue; // promise not yet expired — hands off
        const promisedMs = esc.expiresAt - esc.createdAt;
        resolveEscalation(
          esc.id,
          'stale',
          'timeout-default',
          `timeout-default: human never answered within ${formatIdleMs(promisedMs)}; outcome defaulted to ${esc.recommended ?? 'none (card expired unactioned)'}`,
        );
        recordSupervisorAudit({
          kind: 'reconcile',
          project,
          session: esc.session,
          detail: JSON.stringify({
            source: 'reconcile-pass',
            escalationId: esc.id,
            ageMs: age,
            reason: 'expired',
            expiresAt: esc.expiresAt,
          }),
        });
        continue;
      }

      // Legacy path (expiresAt NULL): today's stale-window sweep, byte-identical.
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
    const { rolledUp, terminalizedDropped, flagged } = await sweepEpicRollups(project);
    for (const epicId of rolledUp) {
      await surfaceEpicLand(project, epicId, { sessionHint: 'coordinator' });
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: 'coordinator',
        detail: JSON.stringify({ source: 'reconcile-pass', epicId, rolledUp: true, reason: 'epic-children-all-done-accepted' }),
      });
    }
    for (const epicId of terminalizedDropped) {
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: 'coordinator',
        detail: JSON.stringify({ source: 'reconcile-pass', epicId, terminalizedDropped: true, reason: 'epic-terminalized-dropped' }),
      });
    }
    for (const f of flagged) {
      // Audit tells the truth per trigger (crit-1): the old line stamped every flag
      // 'epic-all-done-but-unaccepted' regardless of reason.
      const auditDetail =
        f.reason === 'landed-needs-review'
          ? { flag: 'epic-landed-needs-review', children: f.children, inProgress: f.inProgress ?? 0, doneUnaccepted: f.doneUnaccepted ?? 0 }
          : f.reason === 'motionless'
            ? { flag: 'epic-motionless', children: f.children, idleForMs: f.idleForMs ?? 0 }
            : { flag: 'epic-all-done-but-unaccepted', children: f.children, unaccepted: f.unaccepted };
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: 'coordinator',
        detail: JSON.stringify({ source: 'reconcile-pass', epicId: f.epicId, ...auditDetail }),
      });

      if (f.reason === 'landed-needs-review' || f.reason === 'motionless') {
        const epicShortId = f.epicId.slice(0, 8);
        let questionText: string;
        let detailLine: string;

        if (f.reason === 'landed-needs-review') {
          const inProgress = f.inProgress ?? 0;
          const doneUnaccepted = f.doneUnaccepted ?? 0;
          const phrases: string[] = [];
          if (inProgress > 0) {
            phrases.push(`${inProgress} stuck in-progress leftover(s)`);
          }
          if (doneUnaccepted > 0) {
            phrases.push(`${doneUnaccepted} done-but-unaccepted child(ren)`);
          }
          const phrase = phrases.join(' and ');
          questionText = `Epic "${epicShortId}" has landed but ${phrase} that need review before closure.`;
          detailLine = `Total children: ${f.children}, In progress: ${inProgress}, Done but unaccepted: ${doneUnaccepted}`;
        } else {
          const idleFmt = formatIdleMs(f.idleForMs ?? 0);
          questionText = `Epic "${epicShortId}" has ${f.children} child(ren) idle for ${idleFmt} past the sweep threshold and need attention.`;
          detailLine = `Total children: ${f.children}, Idle for: ${idleFmt}`;
        }

        createEscalation({
          project,
          session: 'coordinator',
          kind: EPIC_SWEEP_TRIAGE_KIND,
          todoId: f.epicId,
          questionText,
          audience: 'internal',
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
    const strandedSummary = await sweepStrandedEpics(project);
    if (strandedSummary.errors > 0) {
      console.warn(`[reconcile-pass] stranded-epic sweep had ${strandedSummary.errors} error(s) for ${project}`);
    }
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
  // 3i. DEAD-BUCKET REVIVAL: a bucket epic (Inbox/Bugfix inbox/Flaky quarantine)
  // terminalized by the drop cascade is a silent sink for every future file_to_bucket
  // call. Revive it to planned and restore the collateral children the cascade
  // clobbered. Idempotent; only done/dropped buckets are selected.
  // -------------------------------------------------------------------------
  await yieldToLoop();
  try {
    await reviveTerminalBuckets(project);
  } catch (err) {
    console.warn(
      `[reconcile-pass] dead-bucket revival sweep failed for ${project}:`,
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
  // Audit item 7: ONE full-table todos read shared by the dangling-dep sweep (3i,
  // read-only) and the dep-strand sweep's phase 1 (3j, mutating but idempotent —
  // settleDupOfLanded's own completedBy guard makes iterating a point-in-time list
  // safe). 3j re-reads fresh ONLY after phase 1 actually found settle candidates,
  // preserving its "card phase never sees stale held state" freshness contract.
  let strandTodos: Todo[] = [];
  let strandById = new Map<string, Todo>();
  let strandReadOk = false;
  try {
    strandTodos = listTodos(project, { includeCompleted: true });
    strandById = new Map(strandTodos.map((t) => [t.id, t]));
    strandReadOk = true;
  } catch (err) {
    console.warn(
      `[reconcile-pass] shared todos read failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }
  try {
    if (!strandReadOk) throw new Error('shared todos read failed — skipping dangling-dep sweep');
    const allTodos = strandTodos;
    const byId = strandById;

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
        audience: 'human',
        questionText:
          `Todo "${t.title ?? shortId}" (${shortId}) is parked deps-pending indefinitely: dependsOn references ` +
          `${dangling.length} dangling id(s) that resolve to no todo: ${depList}. Fix: re-point or remove the bad ` +
          `dependsOn id(s) (edit the todo's deps), or drop this todo if it's no longer needed.`,
      });
    }

    // Auto-close: a 'dangling-deps' card whose todo has since gone terminal, or whose
    // dependsOn no longer has ANY dangling id (the edge was fixed / the ambiguity
    // resolved), is moot. PHASE over the pass-top escalation snapshot (item 8) — the
    // per-row getEscalation status re-check below preserves freshness before writing.
    const openDangling = openEscalations.filter((e) => e.kind === DANGLING_DEPS_KIND);
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
  // 3k. PARENTLESS-LEAF SWEEP: a grandfathered kind:'leaf' row with no parentId is
  // permanently unclaimable (incident b053b529 — invisible 5+ hours while every epic
  // starved). The store now refuses to CREATE one (parentless-leaf-refused), so this
  // sweep only ever sees pre-guard rows: raise exactly one deduped human card per
  // orphan past the 1h grace window; never auto-drop. Reuses the shared todos read.
  // -------------------------------------------------------------------------
  await yieldToLoop();
  try {
    if (strandReadOk) {
      sweepParentlessLeaves(project, { now, todos: strandTodos });
    }
  } catch (err) {
    console.warn(
      `[reconcile-pass] parentless-leaf sweep failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // -------------------------------------------------------------------------
  // 3j. DEP-STRAND SETTLE + DECISION SWEEP (the surfacing/wiring half of
  // dep-settlement.ts): a leaf held `dup-of-landed:<sha8>` (or plain `manual`) is
  // neither `done` nor `dropped`, so `depSatisfied` never satisfies it and every
  // dependent parks 'deps-pending' forever; a DROPPED leaf's dependents park
  // 'dep-dropped' forever. The dep-settlement primitives exist for exactly this
  // class but nothing called them from the periodic pass, so the strand had no
  // signal at all. This sweep is that caller, in three phases:
  //   1. SELF-SETTLE the safe case: a held `dup-of-landed:<sha8>` leaf carries its own
  //      proof (the landed sha), so settleDupOfLanded marks it done+accepted with a
  //      `dup-of-landed:` provenance handle and fires the dep-terminal kick — its
  //      dependents become claimable within THIS pass. Idempotent via the primitive's
  //      own completedBy guard.
  //   2. RE-READ, so the card phase sees settled state (a just-settled dep must not
  //      also get a spurious "strands its dependents" card in the same pass).
  //   3. CARD the cases a primitive must NOT auto-resolve: dropping or re-pointing a
  //      live dependent's edge is a human decision (68b8bb09 — the dependsOn DAG's
  //      blast radius is invisible at click time), so raise ONE durable
  //      DEP_STRAND_DECISION_KIND card naming the strander + the stranded dependents.
  //      Dedup is the usual stable-questionText discipline: the text is built ONLY from
  //      sorted short-ids (count derived from them), never a per-run token/timestamp, so
  //      a persisting strand does not flood a card every ~150s tick (the BP0 lesson).
  // Auto-close mirrors 3i: the card is moot once the strander settles (done+accepted)
  // or nothing depends on it any more (edges re-pointed / dependents dropped).
  // -------------------------------------------------------------------------
  await yieldToLoop();
  try {
    // Phase 1 — HELD-DUP SELF-SETTLE (mutating; must run BEFORE the card phases).
    // Iterates the SHARED read from 3i (item 7): the candidate filter (held
    // `dup-of-landed:<sha8>`, non-terminal) is stable within the pass, and
    // settleDupOfLanded is idempotent via its own completedBy guard, so a
    // point-in-time list is safe to walk.
    let settleCandidates = 0;
    const phase1Todos = strandReadOk ? strandTodos : listTodos(project, { includeCompleted: true });
    for (const t of phase1Todos) {
      if (t.status === 'done' || t.status === 'dropped') continue;
      if (typeof t.heldReason !== 'string' || !t.heldReason.startsWith(`${DUP_OF_LANDED}:`)) continue;
      const sha8 = t.heldReason.split(':')[1];
      if (!sha8) continue; // tokenless hold — no landed proof to settle against; phase 3 cards it
      settleCandidates++;
      try {
        await settleDupOfLanded(project, t.id, {
          landedCommit: sha8,
          actor: 'reconcile',
          reason: 'held-dup-of-landed self-settle',
        });
      } catch (err) {
        console.warn(
          `[reconcile-pass] dup-of-landed self-settle failed for ${t.id.slice(0, 8)}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Phase 2 — the card phase must never see stale held state, so re-read AFTER
    // settling — but ONLY when phase 1 actually had candidates to settle (item 7:
    // with zero candidates nothing was mutated and the shared read is still exact,
    // so the second full-table scan is skipped).
    const allTodos = settleCandidates > 0 || !strandReadOk
      ? listTodos(project, { includeCompleted: true })
      : strandTodos;
    const byId = settleCandidates > 0 || !strandReadOk
      ? new Map(allTodos.map((t) => [t.id, t]))
      : strandById;

    // Cheap pre-filter: the exact set of todo ids that some non-terminal todo's
    // `dependsOn` resolves to (same resolveDepId logic dependentsOf/claimability use).
    // Without it, EVERY dropped/held row would pay dependentsOf's own full-table scan —
    // on a large project that is the distributed loop-starvation this pass exists to
    // avoid. A row nothing depends on cannot strand anything, so it is skipped here.
    const referenced = new Set<string>();
    for (const t of allTodos) {
      if (t.status === 'done' || t.status === 'dropped') continue;
      for (const dep of t.dependsOn ?? []) {
        const resolved = resolveDepId(dep, byId);
        if (resolved) referenced.add(resolved.id);
      }
    }

    // Phase 3 — DROPPED-WITH-DEPENDENTS + HELD-STRANDING decision cards.
    for (const t of allTodos) {
      try {
        if (!referenced.has(t.id)) continue;
        if (hasTerminalEpicAncestor(t, byId)) continue;

        let stranded: typeof allTodos = [];
        let stateLabel: string;
        if (t.status === 'dropped') {
          stranded = dependentsOf(project, t.id).filter((d) => claimReason(d, byId) === 'dep-dropped');
          stateLabel = 'dropped';
        } else if (
          t.status !== 'done' &&
          (t.heldReason === 'manual' || (typeof t.heldReason === 'string' && t.heldReason.startsWith(`${DUP_OF_LANDED}:`)))
        ) {
          // A dup-token leaf only reaches here when phase 1 could not settle it (no sha).
          stranded = dependentsOf(project, t.id).filter((d) => claimReason(d, byId) === 'deps-pending');
          stateLabel = `held: ${t.heldReason}`;
        } else {
          continue;
        }
        stranded = stranded.filter((d) => !hasTerminalEpicAncestor(d, byId));
        if (stranded.length === 0) continue;

        const shortIds = stranded.map((d) => d.id.slice(0, 8)).sort();
        createEscalation({
          project,
          session: 'coordinator',
          kind: DEP_STRAND_DECISION_KIND,
          todoId: t.id,
          audience: 'human',
          questionText:
            `Leaf ${t.id.slice(0, 8)} (${stateLabel}) strands ${shortIds.length} dependent(s): ${shortIds.join(', ')}. ` +
            `Remediate: re-point those dependsOn edges to the landed/replacement leaf (${repointDependents.name}), ` +
            `or drop the stranded dependents.`,
          conditionKey: depStrandConditionKey(t.id, stranded.map((d) => d.id)),
          conditionTuple: ['dep-strand', t.id.slice(0, 8), ...shortIds],
        });
      } catch (err) {
        console.warn(
          `[reconcile-pass] dep-strand card failed for ${t.id.slice(0, 8)}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Phase 4 — AUTO-CLOSE (mirrors 3i's dangling-deps auto-close). PHASE over the
    // pass-top escalation snapshot (item 8) — the per-row getEscalation status
    // re-check below preserves freshness before writing.
    const openStrand = openEscalations.filter((e) => e.kind === DEP_STRAND_DECISION_KIND);
    for (const esc of openStrand) {
      try {
        if (!esc.todoId) continue;
        if (getEscalation(esc.id)?.status !== 'open') continue;
        const todo = byId.get(esc.todoId) ?? getTodo(project, esc.todoId);
        if (!todo) continue; // todo itself gone — leave for the stale sweep to age it out
        const settled = todo.status === 'done' && todo.acceptanceStatus === 'accepted';
        const noDependents = dependentsOf(project, esc.todoId).length === 0;
        if (!settled && !noDependents) continue;
        resolveEscalation(esc.id, 'resolved', 'ai');
        recordSupervisorAudit({
          kind: 'reconcile',
          project,
          session: 'coordinator',
          detail: JSON.stringify({
            source: 'reconcile-pass',
            escalationId: esc.id,
            todoId: esc.todoId,
            reason: settled ? 'strander-settled' : 'dependents-repointed',
          }),
        });
      } catch (err) {
        console.warn(
          `[reconcile-pass] dep-strand auto-close failed for ${esc.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[reconcile-pass] dep-strand sweep failed for ${project}:`,
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
      // Dep-strand decision cards (3j) are excluded for the same structural reason: the
      // DROPPED-strander variant links a todo that is dropped BY CONSTRUCTION, so the
      // 'dropped ⇒ moot' gate below would close it every pass while 3j — whose strand is
      // still real — re-raises it the next pass: a create/close flood, not a resolution.
      // 3j owns its own auto-close (strander settled, or nothing depends on it any more).
      if (esc.kind === DEP_STRAND_DECISION_KIND) continue;
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
