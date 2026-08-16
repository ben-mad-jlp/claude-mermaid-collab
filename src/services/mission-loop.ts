/**
 * mission-loop.ts — the mission driver nudges the conductor for convergence.
 *
 * A per-watched-project orchestrator pass that nudges the (autonomous) conductor to
 * drive their active mission. Mission status is derived (never stored); the pass
 * reads it and decides whether to nudge:
 *
 *   - needs-discovery / needs-verify: nudge the conductor (with status-specific instruction)
 *   - blocked: nudge ONCE, then silence (lastNudgeAt prevents spam)
 *   - building / over-budget / terminal (converged/abandoned): no nudge
 *
 * Nudges are idle-gated (never disturb a busy session) and debounced (lastNudgeAt
 * cooldown) so the pass can't spam.
 *
 * `planMissionLoopStep` is PURE (no I/O) → fully unit-tested; the runner is a thin
 * apply-the-action shell over injectable deps.
 */

import type { MissionStatus, MissionSummary } from './mission-store.ts';
import { listMissions, stampMissionNudge, isMissionTerminal, collectMissionStatusFacts, getMission, listCriteriaWithActions } from './mission-store.ts';
import { getStatus } from './session-status-store.ts';
import { fireStamp } from './nudge-stamp.ts';
import { resolveNudgeTarget, CONDUCTOR_SESSION } from './nudge-target.ts';
import {
  MISSION_STALLED_KIND,
  baseReason,
  buildStallCardText,
  clearMissionStall,
  noteMissionLoopReason,
  sweepRedTrunkSilence,
  type MissionLoopReasonBase,
  type MissionLoopReasonFacts,
  type RepairTodoState,
} from './mission-stall.ts';
import { getLatestBaseGateVerdictForBase, latestLedgerTsForEpics } from './worker-ledger.ts';
import { isClaimable } from './claimability';
import { listTodos } from './todo-store.ts';
import { execFileSync } from 'node:child_process';
import {
  evaluateMissionStall,
  missionStallConditionKey,
  noteStallObservation,
  clearStallObservation,
  IN_FLIGHT_COUNTER_KEYS,
  isVerifyOwedPastThreshold,
  verifyOwedConditionKey,
  type MissionStallFacts,
} from './mission-stall-predicate.ts';
import { raiseOverBudgetRebetCard } from './mission-budget-gate.ts';
import { VERIFY_OWED_BACKSTOP_MS } from './harness-caps.ts';
import { createEscalation, listOpenEscalations, resolveEscalation } from './supervisor-store.ts';

export const MISSION_NUDGE_COOLDOWN_MS = 15 * 60 * 1000; // 15 min between nudges per mission
export const MISSION_NUDGE_ESCALATION_MS = 2 * 60 * 60 * 1000; // 2 hour escalation ceiling

// ---------------------------------------------------------------------------
// Throttle (mission c4eb4fcc, Phase 4): keep the mission-loop pass OFF the every-tick
// (~30s) cadence.
//
// runMissionLoopPass calls listMissions(project) once per tick, and listMissions is the
// single heaviest per-tick scanner in the whole loop: for EACH mission root it reads the
// full todos table THREE times — getMission → collectMissionStatusFacts (1 listTodos),
// getMissionRollup (1 listTodos), and getMissionRollup → collectMissionStatusFacts
// (1 listTodos) — plus one listTodos to enumerate the roots. On the 8MB self-project with
// ~5 missions that is ~1 + 3×5 = 16 synchronous full-table `.all()` scans (each ~26-130ms)
// EVERY tick, holding the shared HTTP event loop for hundreds of ms. None of that work is
// latency-critical: the pass only NUDGES the conductor for a mission's derived status, and
// the nudge itself is already debounced by a 15-MINUTE cooldown — so 30s freshness buys
// nothing. Gate the whole pass to run at most once per MISSION_LOOP_INTERVAL_MS per project
// (same proven shape as reconcile-pass's RECONCILE_INTERVAL_MS). This is a HYGIENE/advance
// pass, not the ready-todo CLAIM path (runBuildPass / kickOrchestrator), which stays
// every-tick responsive.
// ---------------------------------------------------------------------------

/** Minimum spacing between mission-loop passes for a single project. The nudge cooldown is
 *  15 min, so a 2.5-min scan cadence is still far tighter than the nudge it drives. */
export const MISSION_LOOP_INTERVAL_MS = 150_000; // 2.5 min

const lastMissionLoopMs = new Map<string, number>();

/**
 * Throttle gate for runMissionLoopPass. Returns true (and records `now` as the last run)
 * when the pass is due for `project`; false when a previous run is still within
 * MISSION_LOOP_INTERVAL_MS. First call for a project always runs. `now` is injectable for
 * deterministic tests.
 */
export function shouldRunMissionLoopPass(project: string, now: number = Date.now()): boolean {
  const last = lastMissionLoopMs.get(project);
  if (last !== undefined && now - last < MISSION_LOOP_INTERVAL_MS) return false;
  lastMissionLoopMs.set(project, now);
  return true;
}

/** Test seam: clear the per-project throttle clock (all projects, or one). */
export function _resetMissionLoopThrottle(project?: string): void {
  if (project === undefined) lastMissionLoopMs.clear();
  else lastMissionLoopMs.delete(project);
}

/**
 * Every reason `planMissionLoopStep` may return with `kind: 'none'`. Derived from
 * mission-stall.ts's `MissionLoopReasonBase` (plus the `no-action:<status>` detail form),
 * so a NEW no-op reason cannot be introduced here without adding it to that module's
 * QUIET/STALLED classification table — the whole point of mission a6ab522b's incident:
 * some of these mean "all is well", others mean "nobody is coming", and nothing in the
 * code used to tell them apart.
 */
export type MissionLoopNoneReason = MissionLoopReasonBase | `no-action:${string}`;

export type MissionLoopAction =
  | { kind: 'none'; reason: MissionLoopNoneReason }
  | { kind: 'nudge'; session: string; message: string; reason: string; key: string };

export interface MissionLoopStepInput {
  mission: { todoId: string; status: MissionStatus; lastNudgeAt: number | null; lastNudgeKey: string | null; title: string; active: boolean };
  rollup: { capability: { met: number; total: number }; gaps?: number; awaitingVerify?: number };
  target: string | null;
  /** Is the conductor session idle (safe to nudge without interrupting active work)? */
  idle: boolean;
  now: number;
  cooldownMs: number;
  escalationMs: number;
}

function goalOf(title: string): string {
  return title.replace(/^\s*\[MISSION\]\s*/i, '').trim() || 'mission';
}

/** Nudge-dedup fingerprint. Includes the open-gap + awaiting-verify counts (not just
 *  met/total) so filing SOME of the needed epics — met/total unchanged — still reads as
 *  material change and the remaining gaps get re-nudged after cooldown. */
function fingerprint(m: MissionLoopStepInput['mission'], rollup: MissionLoopStepInput['rollup']): string {
  return `${m.status}:${rollup.capability.met}/${rollup.capability.total}:g${rollup.gaps ?? 0}:v${rollup.awaitingVerify ?? 0}`;
}

/** The standing CONDUCTOR discipline, prepended to every nudge (lever #1). A mission
 *  is driven by a CONDUCTOR: it directs the players (files [EPIC]+leaves, approves
 *  them for the daemon to build), it does NOT play the instruments (no hand-editing
 *  source). Building is the daemon's mechanical EXECUTE job. */
const CONDUCTOR_PREAMBLE =
  'You are the CONDUCTOR of this mission — you ORCHESTRATE, you do NOT hand-build. ' +
  'Decompose the gap into an [EPIC] + leaves and approve them (make ready) so the daemon builds them; ' +
  'do not hand-edit source yourself. (Load /conductor if you have not.)';

function nudgeMessage(status: MissionStatus, m: MissionLoopStepInput['mission'], rollup: MissionLoopStepInput['rollup'], now: number): string {
  const goal = goalOf(m.title);
  const stamp = fireStamp(now);
  const head = `${stamp} 🎯 Mission «${goal}»`;
  switch (status) {
    case 'needs-discovery': {
      const gaps = rollup.gaps ?? 0;
      const gapText = gaps > 0 ? `${gaps} criteria have no live serving epic` : 'some criteria have no live serving epic';
      return `${head} is NOT converged — ${rollup.capability.met}/${rollup.capability.total} criteria met; ${gapText}. ${CONDUCTOR_PREAMBLE}\nRead get_mission's per-criterion actions and serve EVERY 'discover' gap in this pass: every gap served (one right-sized epic MAY serve several related aspect criteria — set servesCriterionIds; never thin one-todo epics), filed AND approved together — the daemon parallelizes safely; do not dribble one epic per pass or hand-manage file overlap. A 'discover' on a criterion that already has a filed-but-unapproved epic means FINISH that epic (approve it), not file a duplicate.`;
    }
    case 'needs-verify':
      return `${head} needs VERIFY. Run /verify-mission — the INDEPENDENT gate checks each criterion against ground truth (${rollup.capability.met}/${rollup.capability.total} currently met${(rollup.awaitingVerify ?? 0) > 0 ? `, ${rollup.awaitingVerify} awaiting verdicts` : ''}). Then serve any remaining 'discover' gaps in the same pass.`;
    case 'blocked':
      return `${head} is BLOCKED — a mission leaf is parked/rejected/escalated or an unapproved split. ${CONDUCTOR_PREAMBLE}\nResolve the blocker (review the rejected leaf, approve the split, or handle the escalation).`;
    default:
      return `${head} needs attention (status: ${status}).`;
  }
}

/**
 * Decide the single action for one mission this tick. PURE.
 *  - inactive → none.
 *  - terminal (converged, closed, or abandoned) → none.
 *  - building / over-budget → none (wait or address the budget).
 *  - blocked: nudge ONCE (blocked-silenced if already nudged).
 *  - needs-discovery / needs-verify: nudge (debounced by fingerprint + cooldown + escalation).
 *
 * Driving is gated by the mission's `active` flag (one active mission per session) —
 * NOT a per-project mode. The orchestrator only calls the pass for WATCHED projects.
 */
export function planMissionLoopStep(input: MissionLoopStepInput): MissionLoopAction {
  const { mission, rollup, target, idle, now, cooldownMs, escalationMs } = input;
  if (!mission.active) return { kind: 'none', reason: 'inactive' };
  if (mission.status === 'converged') return { kind: 'none', reason: 'converged' };
  if (mission.status === 'closed') return { kind: 'none', reason: 'closed' };
  if (mission.status === 'abandoned') return { kind: 'none', reason: 'abandoned' };
  if (mission.status === 'over-budget') return { kind: 'none', reason: 'over-budget' };
  // Already inside a stall episode (the derived status flipped past the grace window). The
  // runner has carded it; nudging on top would be noise. Classified STALLED, so the episode
  // stays open and the mission keeps reading 'stalled' until it genuinely moves.
  if (mission.status === 'stalled') return { kind: 'none', reason: 'stalled' };
  if (mission.status === 'building') return { kind: 'none', reason: 'building' };

  if (!target) return { kind: 'none', reason: 'no-nudge-target' };
  if (!idle) return { kind: 'none', reason: 'session-busy' };

  // blocked: nudge once, then silence (never re-nudge blocked until it changes)
  if (mission.status === 'blocked') {
    if (mission.lastNudgeAt != null) return { kind: 'none', reason: 'blocked-silenced' };
    return {
      kind: 'nudge',
      session: target,
      message: nudgeMessage(mission.status, mission, rollup, now),
      reason: 'nudge:blocked',
      key: fingerprint(mission, rollup),
    };
  }

  // needs-discovery / needs-verify: nudge if fingerprint changed or escalation ceiling reached
  if (mission.status === 'needs-discovery' || mission.status === 'needs-verify') {
    const key = fingerprint(mission, rollup);

    // First nudge (no prior nudge).
    if (mission.lastNudgeAt == null) {
      return {
        kind: 'nudge',
        session: target,
        message: nudgeMessage(mission.status, mission, rollup, now),
        reason: `nudge:${mission.status}`,
        key,
      };
    }

    const changed = mission.lastNudgeKey !== key;
    const pastCooldown = now - mission.lastNudgeAt >= cooldownMs;
    const escalated = now - mission.lastNudgeAt >= escalationMs;

    // Nudge only if past cooldown AND (state changed OR escalation ceiling hit).
    if (pastCooldown && (changed || escalated)) {
      return {
        kind: 'nudge',
        session: target,
        message: nudgeMessage(mission.status, mission, rollup, now),
        reason: `nudge:${mission.status}`,
        key,
      };
    }

    // Silence unchanged within cooldown and escalation ceiling.
    return { kind: 'none', reason: changed ? 'nudge-cooldown' : 'nudge-fingerprint-unchanged' };
  }

  return { kind: 'none', reason: `no-action:${mission.status}` };
}

export interface MissionLoopDeps {
  list?: (project: string) => MissionSummary[];
  /** Audit item 7a: the orchestrator tick's shared per-project todos snapshot
   *  (`listTodos(project, { includeCompleted: true })`, read ONCE per tick). When provided
   *  (and `list` is not), listMissions and the stall-facts collector read it via their
   *  `allTodos` seams instead of re-scanning the table ~1+3N times. Absent ⇒ self-read —
   *  external callers unchanged. This pass never mutates todos (nudges/stamps live in the
   *  mission sidecar), so a start-of-tick snapshot is exact, not stale. */
  todosSnapshot?: import('./todo-store.ts').Todo[];
  isIdle?: (project: string, session: string) => boolean;
  nudge?: (project: string, session: string, text: string) => Promise<'sent' | 'busy' | 'undeliverable'>;
  stampNudge?: (project: string, todoId: string, key?: string) => void;
  now?: number;
  cooldownMs?: number;
  escalationMs?: number;
  /** Injectable card surfaces (test spies). Default to the real store / gate. */
  createEscalation?: typeof createEscalation;
  raiseRebetCard?: typeof raiseOverBudgetRebetCard;
  /** Test seam: override the stall-facts collector so a test can drive every scenario
   *  purely via injection, without DB fixtures. Defaults to collectMissionStallFacts. */
  buildStallFacts?: (project: string, m: MissionSummary, now: number) => MissionStallFacts;
  /** Test seam: override forward-progress resolution of an open stall escalation.
   *  Defaults to the listOpenEscalations + resolveEscalation lookup below. */
  resolveStallEscalation?: (project: string, conditionKey: string) => void;
  /** Test seam: override project-scoped target resolution. Defaults to resolveNudgeTarget. */
  resolveTarget?: (project: string) => string;
  /** Test seam: override the red-trunk silence sweep (mission-stall.ts). Defaults to
   *  runRedTrunkSilenceSweep, which resolves the trunk sha + real ledger/todo readers. */
  redTrunkSweep?: (project: string, now: number) => void;
}

// ---------------------------------------------------------------------------
// Red-trunk silence alarm wiring (2026-08-14: master red 7h+, zero escalations).
// The pure sweep lives in mission-stall.ts; THIS is the deps-assembly shell — same
// split as evaluateMissionStall / collectMissionStallFacts above.
// ---------------------------------------------------------------------------

/** The trunk sha this project's shared verdicts are keyed on: HEAD of the MAIN checkout
 *  (main-checkout invariant — the main root sits on trunk). Null when the project is not
 *  a resolvable git root (fail-open: no alarm, never a broken pass). */
function resolveTrunkSha(project: string): string | null {
  try {
    const sha = execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch { return null; }
}

/** Live state of the trunk's repair filing, from the work-graph: absent (nothing filed),
 *  claimable (a baseRepair todo is 'ready' — the daemon could dispatch it), else
 *  unclaimable (filed in a state the daemon never schedules — the incident class). */
function readRepairTodoState(project: string): RepairTodoState {
  try {
    const all = listTodos(project);
    const repairs = all.filter((t) => (t.baseRepair ?? 0) !== 0);
    if (repairs.length === 0) return 'absent';
    const byId = new Map(all.map((t) => [t.id, t]));
    return repairs.some((t) => isClaimable(t, byId)) ? 'claimable' : 'unclaimable';
  } catch { return 'absent'; }
}

/** Default red-trunk sweep: real trunk sha + real worker-ledger/todo/escalation deps. */
function runRedTrunkSilenceSweep(project: string, now: number): void {
  const trunkSha = resolveTrunkSha(project);
  if (!trunkSha) return;
  sweepRedTrunkSilence(project, trunkSha, {
    now: () => now,
    readTrunkVerdict: (sha) => {
      const row = getLatestBaseGateVerdictForBase(sha);
      return row
        ? { status: row.status, baseSha: row.baseSha, resultJson: row.resultJson, measuredAt: row.measuredAt }
        : null;
    },
    lastBaseRepairDispatchAt: () => {
      try {
        const epicIds = listTodos(project)
          .filter((t) => (t.baseRepair ?? 0) !== 0)
          .map((t) => t.id);
        return latestLedgerTsForEpics(epicIds);
      } catch { return null; }
    },
    repairTodoState: () => readRepairTodoState(project),
    escalate: (card) => {
      createEscalation({
        project,
        session: 'mission-loop',
        kind: card.kind,
        questionText: card.questionText,
        operatorGated: true,
        audience: 'human',
        conditionKey: card.conditionKey,
        conditionTuple: card.conditionTuple,
        timeoutMs: card.timeoutMs,
      });
    },
    resolveOpenCard: (conditionKey) => resolveStallEscalation(project, conditionKey),
  });
}

/**
 * Derive the condition key for a stall raise, using the same key that the dedup read uses.
 * When verify-owed ids are present, use the verify-owed key; otherwise use the legacy
 * mission-stalled key based on all blocked ids.
 */
function stallCardConditionKey(missionId: string, keyIds: string[], verifyOwedIds: string[]): string {
  if (verifyOwedIds.length >= 1) {
    return verifyOwedConditionKey(missionId, verifyOwedIds);
  }
  return missionStallConditionKey(missionId, keyIds);
}

/**
 * Collect the facts `evaluateMissionStall` needs for one mission, from signals already
 * available at the mission-loop call site (`m: MissionSummary`) plus one extra
 * `listCriteriaWithActions` call (the same scan `collectMissionStatusFacts` already does).
 */
function collectMissionStallFacts(project: string, m: MissionSummary, now: number, allTodos?: import('./todo-store.ts').Todo[]): MissionStallFacts {
  const missionId = m.node.id;
  const criteria = listCriteriaWithActions(project, missionId);

  // Partition criteria into three sets: escalate/blocked, verify-owed, and age-gated discover-stuck
  const blockedCriterionIds = criteria
    .filter((c) => c.action === 'escalate')
    .map((c) => c.id);

  const verifyOwedIds = criteria
    .filter((c) => isVerifyOwedPastThreshold(c, now, VERIFY_OWED_BACKSTOP_MS))
    .map((c) => c.id);

  const discoverStuckIds = criteria
    .filter((c) =>
      c.action === 'discover' &&
      c.servingEpicState === 'none' &&
      !c.servingEpicLive &&
      now - (c.updatedAt ?? 0) >= VERIFY_OWED_BACKSTOP_MS
    )
    .map((c) => c.id);

  // Activation rule: stuck is only populated when there are verify-owed or discover-stuck ids
  const stuck = (verifyOwedIds.length || discoverStuckIds.length)
    ? [...new Set([...blockedCriterionIds, ...verifyOwedIds, ...discoverStuckIds])]
    : undefined;

  const serveableGaps = m.rollup.gaps ?? 0;
  const awaitingVerify = m.rollup.awaitingVerify ?? 0;
  const epicsBuilding = m.epics.filter((e) => e.status === 'in_progress').length;
  const landInFlight = m.epics.filter((e) => e.status === 'done' && e.acceptanceStatus === 'pending').length;

  let hasBuildingLeaf = false;
  try {
    // 7a: thread the tick's shared snapshot (when present) so the stall check costs
    // zero extra full-table scans; absent ⇒ the stores self-read as before.
    const missionRow = getMission(project, missionId, { allTodos });
    if (missionRow) hasBuildingLeaf = collectMissionStatusFacts(project, missionRow, now, { allTodos }).hasBuildingLeaf;
  } catch { /* fail closed to false */ }

  let recycling = 0;
  try {
    const session = resolveNudgeTarget(project);
    if (getStatus(project, session)?.recycleState === 'recovering') recycling = 1;
  } catch { /* fail closed to 0 */ }

  const keyIds = stuck ?? blockedCriterionIds;
  const conditionKey = stallCardConditionKey(missionId, keyIds, verifyOwedIds);
  let hasOpenCardForKey = false;
  try {
    hasOpenCardForKey = listOpenEscalations().some((e) => e.project === project && e.conditionKey === conditionKey);
  } catch { /* fail closed to false */ }

  return {
    missionActive: m.mission.active !== false,
    unmetCriteria: m.criteria.filter((c) => !c.met).length,
    serveableGaps,
    awaitingVerify,
    verifyInFlight: awaitingVerify,
    epicsBuilding,
    leavesRunning: hasBuildingLeaf ? 1 : 0,
    landInFlight,
    integrating: 0,
    recycling,
    budgetPaused: m.mission.status === 'over-budget',
    baseRedCooldown: false,
    blockedCriterionIds,
    hasOpenCardForKey,
    stuckCriterionIds: stuck,
    verifyOwedCriterionIds: verifyOwedIds.length > 0 ? verifyOwedIds : undefined,
  };
}

/** Resolve an open stall escalation for `project`/`conditionKey`, if one exists. */
function resolveStallEscalation(project: string, conditionKey: string): void {
  const open = listOpenEscalations().find((e) => e.project === project && e.conditionKey === conditionKey);
  if (open) resolveEscalation(open.id, 'resolved', 'ai');
}

/** Facts recorded at raise time for a mission's currently-open stall card, so a later
 *  tick can detect genuine forward progress and resolve the card. Keyed like episodeKey
 *  (`${project} ${missionId}`). */
const openStallByMission = new Map<string, { conditionKey: string; unmetCriteria: number; blockedCriterionIds: string[] }>();

/** Test seam: clear the open-stall-card tracker (all missions, or one project+missionId). */
export function _resetOpenStallCards(project?: string, missionId?: string): void {
  if (project === undefined) { openStallByMission.clear(); return; }
  openStallByMission.delete(`${project} ${missionId}`);
}

export interface MissionLoopResult {
  project: string;
  nudged: string[];
  skipped: number;
  /** Mission ids the pass carded as STALLED this run (one card per stall episode). */
  stalled: string[];
  /** Mission ids for which an over-budget re-bet card exists after this run. */
  overBudget: string[];
}

/**
 * NO SILENT STOP. Given this tick's `none` reason for one mission, keep the stall clock
 * fed and — once a STALLED reason has been held past MISSION_STALL_GRACE_MS — raise
 * exactly ONE human card.
 *
 * `over-budget` is the one STALLED reason handled elsewhere and IMMEDIATELY (no grace):
 * it gets the dedicated re-bet card, which carries answerable raise / park / drop options.
 * A generic "this is stuck" card on top of it would be strictly less useful duplicate noise
 * for the same condition, so this arm skips it — the classification still calls it STALLED
 * (it is), which is what keeps the derived status off 'building'.
 *
 * FAILS OPEN: every store touch is wrapped, because a card path must never break the pass.
 */
/**
 * Build the mission facts that let the classifier tell a HEALTHY unchanged fingerprint from a
 * WEDGED one (see mission-stall.ts's CONDITIONALLY_QUIET).
 *
 * Computed ONLY for the reasons that are conditionally classified — every other reason resolves
 * through the table and must not pay collectMissionStallFacts's project scan.
 *
 * `serveableGaps` is the mission-loop's own count of criteria with no live serving epic, i.e. the
 * `discover` gaps; `blockedCriterionIds` are the blocked ones. The in-flight test deliberately
 * EXCLUDES `serveableGaps` from IN_FLIGHT_COUNTER_KEYS: a serveable gap is the very thing that
 * makes an unchanged fingerprint suspicious, so counting it as "in flight" would make the whole
 * refinement vacuous. Fails open to `undefined` (plain table lookup, today's behaviour).
 */
function buildReasonFacts(
  project: string,
  m: MissionSummary,
  now: number,
  deps: MissionLoopDeps,
  reason: MissionLoopNoneReason,
): MissionLoopReasonFacts | undefined {
  if (baseReason(reason) !== 'nudge-fingerprint-unchanged') return undefined;
  try {
    const facts = (deps.buildStallFacts
      ?? ((p: string, mm: MissionSummary, n: number) => collectMissionStallFacts(p, mm, n, deps.todosSnapshot)))(project, m, now);
    return {
      criterionActions: [
        ...Array<string>(Math.max(0, facts.serveableGaps)).fill('discover'),
        ...facts.blockedCriterionIds.map(() => 'blocked'),
      ],
      inflight: IN_FLIGHT_COUNTER_KEYS
        .filter((k) => k !== 'serveableGaps')
        .some((k) => (facts[k] as number) > 0),
    };
  } catch {
    return undefined;
  }
}

function handleNoneReason(
  project: string,
  m: MissionSummary,
  reason: MissionLoopNoneReason,
  now: number,
  deps: MissionLoopDeps,
  result: MissionLoopResult,
  target: string | null,
): void {
  const missionId = m.node.id;
  try {
    noteMissionLoopReason(project, missionId, reason, now, buildReasonFacts(project, m, now, deps, reason));

    if (reason === 'over-budget') {
      const card = (deps.raiseRebetCard ?? raiseOverBudgetRebetCard)(
        project,
        missionId,
        target ?? 'mission-loop',
        m.node.title,
      );
      if (card.raised) result.overBudget.push(missionId);
      return;
    }
  } catch {
    /* fail-open — the stall alarm must never break the mission-loop pass */
  }
}

/**
 * Evaluate the stall conjunction for one mission this tick and, once a STALLED condition
 * has been observed twice, raise exactly one human card. Runs from BOTH the `none` branch
 * (after `handleNoneReason` has fed the classified reason into the clock) and the `nudge`
 * branch (which has no `MissionLoopNoneReason` of its own, so it feeds `noteMissionLoopReason`
 * with the generic `'stalled'` reason here). `noteMissionLoopReason` no-ops the `since`/`reason`
 * on an in-TTL episode, so a same-tick call here never clobbers a more specific reason already
 * fed by `handleNoneReason`.
 *
 * Returns true iff the stall conjunction holds this tick (episode should stay open / survive
 * a nudge); false if it does not (safe to clear).
 *
 * FAILS OPEN: every store touch is wrapped, because a card path must never break the pass.
 */
function evaluateStallAndMaybeRaise(
  project: string,
  m: MissionSummary,
  now: number,
  deps: MissionLoopDeps,
  result: MissionLoopResult,
  target: string | null,
): boolean {
  const missionId = m.node.id;
  try {
    const episodeKey = `${project} ${missionId}`;
    const facts = (deps.buildStallFacts
      ?? ((p: string, mm: MissionSummary, n: number) => collectMissionStallFacts(p, mm, n, deps.todosSnapshot)))(project, m, now);
    const { stalled, conditionKey, blockedCriterionIds, stuckCriterionIds } = evaluateMissionStall(facts, missionId);

    const keyIds = stuckCriterionIds ?? blockedCriterionIds;
    const verifyOwedIds = facts.verifyOwedCriterionIds ?? [];

    if (!stalled) {
      const openEntry = openStallByMission.get(episodeKey);
      if (openEntry) {
        const inFlight = IN_FLIGHT_COUNTER_KEYS.some((k) => (facts[k] as number) > 0);
        const criteriaDropped = facts.unmetCriteria < openEntry.unmetCriteria;
        const blockedChanged =
          [...keyIds].sort().join('\0') !== [...openEntry.blockedCriterionIds].sort().join('\0');
        if (inFlight || criteriaDropped || blockedChanged) {
          clearStallObservation(project, missionId);
          (deps.resolveStallEscalation ?? resolveStallEscalation)(project, openEntry.conditionKey);
          openStallByMission.delete(episodeKey);
        }
      }
      return false;
    }

    const episode = noteMissionLoopReason(project, missionId, 'stalled', now);
    if (!episode) return true; // in-TTL/no-op clock read, but the predicate still says stalled

    const cardConditionKey = stallCardConditionKey(missionId, keyIds, verifyOwedIds);
    const count = noteStallObservation(project, missionId, cardConditionKey);
    if (count < 2) return true;

    (deps.createEscalation ?? createEscalation)({
      project,
      session: target ?? 'mission-loop',
      kind: MISSION_STALLED_KIND,
      todoId: missionId,
      operatorGated: true,
      audience: 'human',
      conditionKey: cardConditionKey,
      conditionTuple: verifyOwedIds.length > 0
        ? ['verify-owed', missionId, ...verifyOwedIds]
        : ['mission-stalled', missionId, ...keyIds],
      questionText: buildStallCardText({
        missionId,
        missionTitle: m.node.title,
        reason: episode.reason,
        stalledForMs: now - episode.since,
      }),
    });
    openStallByMission.set(episodeKey, { conditionKey: cardConditionKey, unmetCriteria: facts.unmetCriteria, blockedCriterionIds: keyIds });
    result.stalled.push(missionId);
    return true;
  } catch {
    /* fail-open — the stall alarm must never break the mission-loop pass */
    return false;
  }
}

/**
 * Run one mission-loop pass for a project. Nudges the conductor for their active,
 * non-terminal missions. The orchestrator only calls this for WATCHED projects —
 * that + the mission `active` flag are the gates; there is no per-project on/off mode.
 */
export async function runMissionLoopPass(project: string, deps: MissionLoopDeps = {}): Promise<MissionLoopResult> {
  // 7a: with a tick-shared snapshot, listMissions' enumeration + per-mission facts read
  // it (via allTodos) instead of paying ~1+3N fresh full-table scans per pass.
  const list = deps.list ?? ((p: string) => listMissions(p, { allTodos: deps.todosSnapshot }));
  const isIdle = deps.isIdle ?? ((p: string, s: string) => {
    const row = getStatus(p, s);
    return row === null || row.status === 'waiting';
  });
  const nudge = deps.nudge ?? (async (_project: string, _session: string, _text: string) => 'undeliverable' as const);
  const stampNudge = deps.stampNudge ?? stampMissionNudge;
  const now = deps.now ?? Date.now();
  const cooldownMs = deps.cooldownMs ?? MISSION_NUDGE_COOLDOWN_MS;
  const escalationMs = deps.escalationMs ?? MISSION_NUDGE_ESCALATION_MS;
  const resolveTarget = deps.resolveTarget ?? resolveNudgeTarget;

  const result: MissionLoopResult = { project, nudged: [], skipped: 0, stalled: [], overBudget: [] };

  // Red-trunk silence alarm: project-level (mission-INDEPENDENT — the 2026-08-14 incident
  // had a red trunk and an unschedulable repair with no mission arm watching). Runs once
  // per pass, before the mission walk; fail-open — the alarm must never break the pass.
  try { (deps.redTrunkSweep ?? runRedTrunkSilenceSweep)(project, now); } catch { /* fail-open */ }

  let missions: MissionSummary[];
  try { missions = list(project); } catch { return result; }

  const target = resolveTarget(project);

  for (const m of missions) {
    const action = planMissionLoopStep({
      mission: {
        todoId: m.node.id, status: m.mission.status ?? 'needs-discovery',
        lastNudgeAt: m.mission.lastNudgeAt ?? null, lastNudgeKey: m.mission.lastNudgeKey ?? null,
        title: m.node.title, active: m.mission.active !== false,
      },
      rollup: { capability: m.rollup.capability },
      target,
      idle: target ? isIdle(project, target) : false,
      now,
      cooldownMs,
      escalationMs,
    });

    try {
      if (action.kind === 'nudge') {
        // A nudge is motion, but the stall conjunction may STILL hold (e.g. an in-flight
        // land or over-budget re-bet) — only clear the episode when it genuinely does not.
        const stillStalled = evaluateStallAndMaybeRaise(project, m, now, deps, result, target);
        if (!stillStalled) {
          clearMissionStall(project, m.node.id);
          clearStallObservation(project, m.node.id);
        }
        await nudge(project, action.session, action.message);
        stampNudge(project, m.node.id, action.key);
        result.nudged.push(m.node.id);
      } else {
        // NO SILENT STOP: classify this no-op and, if it means the mission is stuck,
        // make it visible (stall clock → derived status → exactly one human card).
        handleNoneReason(project, m, action.reason, now, deps, result, target);
        evaluateStallAndMaybeRaise(project, m, now, deps, result, target);
        result.skipped++;
      }
    } catch {
      result.skipped++; // never let one mission break the pass
    }
  }
  return result;
}
