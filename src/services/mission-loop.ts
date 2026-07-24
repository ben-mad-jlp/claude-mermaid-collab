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
import { listMissions, stampMissionNudge, isMissionTerminal } from './mission-store.ts';
import { getStatus } from './session-status-store.ts';
import { fireStamp } from './nudge-stamp.ts';
import {
  MISSION_STALLED_KIND,
  buildStallCardText,
  claimStallCard,
  clearMissionStall,
  isMissionStalled,
  isStalledReason,
  noteMissionLoopReason,
  stallConditionKey,
  type MissionLoopReasonBase,
} from './mission-stall.ts';
import { raiseOverBudgetRebetCard } from './mission-budget-gate.ts';
import { createEscalation } from './supervisor-store.ts';

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
  ownerSession: string | null;
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
 *  - terminal (converged or abandoned) → none.
 *  - building / over-budget → none (wait or address the budget).
 *  - blocked: nudge ONCE (blocked-silenced if already nudged).
 *  - needs-discovery / needs-verify: nudge (debounced by fingerprint + cooldown + escalation).
 *
 * Driving is gated by the mission's `active` flag (one active mission per session) —
 * NOT a per-project mode. The orchestrator only calls the pass for WATCHED projects.
 */
export function planMissionLoopStep(input: MissionLoopStepInput): MissionLoopAction {
  const { mission, rollup, ownerSession, idle, now, cooldownMs, escalationMs } = input;
  if (!mission.active) return { kind: 'none', reason: 'inactive' };
  if (mission.status === 'converged') return { kind: 'none', reason: 'converged' };
  if (mission.status === 'abandoned') return { kind: 'none', reason: 'abandoned' };
  if (mission.status === 'over-budget') return { kind: 'none', reason: 'over-budget' };
  // Already inside a stall episode (the derived status flipped past the grace window). The
  // runner has carded it; nudging on top would be noise. Classified STALLED, so the episode
  // stays open and the mission keeps reading 'stalled' until it genuinely moves.
  if (mission.status === 'stalled') return { kind: 'none', reason: 'stalled' };
  if (mission.status === 'building') return { kind: 'none', reason: 'building' };

  if (!ownerSession) return { kind: 'none', reason: 'no-owner-session' };
  if (!idle) return { kind: 'none', reason: 'session-busy' };

  // blocked: nudge once, then silence (never re-nudge blocked until it changes)
  if (mission.status === 'blocked') {
    if (mission.lastNudgeAt != null) return { kind: 'none', reason: 'blocked-silenced' };
    return {
      kind: 'nudge',
      session: ownerSession,
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
        session: ownerSession,
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
        session: ownerSession,
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
  isIdle?: (project: string, session: string) => boolean;
  nudge?: (project: string, session: string, text: string) => Promise<'sent' | 'busy' | 'no-tmux'>;
  stampNudge?: (project: string, todoId: string, key?: string) => void;
  now?: number;
  cooldownMs?: number;
  escalationMs?: number;
  /** Injectable card surfaces (test spies). Default to the real store / gate. */
  createEscalation?: typeof createEscalation;
  raiseRebetCard?: typeof raiseOverBudgetRebetCard;
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
function handleNoneReason(
  project: string,
  m: MissionSummary,
  reason: MissionLoopNoneReason,
  now: number,
  deps: MissionLoopDeps,
  result: MissionLoopResult,
): void {
  const missionId = m.node.id;
  try {
    const episode = noteMissionLoopReason(project, missionId, reason, now);
    if (!episode) return; // quiet reason — clock cleared, nothing to say

    if (reason === 'over-budget') {
      const card = (deps.raiseRebetCard ?? raiseOverBudgetRebetCard)(
        project,
        missionId,
        m.ownerSession ?? m.assigneeSession ?? 'mission-loop',
        m.node.title,
      );
      if (card.raised) result.overBudget.push(missionId);
      return;
    }

    if (!isMissionStalled(project, missionId, now)) return; // inside the grace window
    // One card per stall EPISODE: claimStallCard is the local bound, the store's
    // conditionKey dedup is the durable one (a restart re-arms the local flag, and the
    // keyed lookup then bumps recurrence in place instead of minting a duplicate).
    if (!claimStallCard(project, missionId)) return;
    (deps.createEscalation ?? createEscalation)({
      project,
      session: m.ownerSession ?? m.assigneeSession ?? 'mission-loop',
      kind: MISSION_STALLED_KIND,
      todoId: missionId,
      operatorGated: true,
      conditionKey: stallConditionKey(missionId, episode.reason),
      conditionTuple: ['mission-stalled', missionId, episode.reason],
      questionText: buildStallCardText({
        missionId,
        missionTitle: m.node.title,
        reason: episode.reason,
        stalledForMs: now - episode.since,
      }),
    });
    result.stalled.push(missionId);
  } catch {
    /* fail-open — the stall alarm must never break the mission-loop pass */
  }
}

/**
 * Run one mission-loop pass for a project. Nudges the conductor for their active,
 * non-terminal missions. The orchestrator only calls this for WATCHED projects —
 * that + the mission `active` flag are the gates; there is no per-project on/off mode.
 */
export async function runMissionLoopPass(project: string, deps: MissionLoopDeps = {}): Promise<MissionLoopResult> {
  const list = deps.list ?? listMissions;
  const isIdle = deps.isIdle ?? ((p: string, s: string) => getStatus(p, s)?.status === 'waiting');
  const nudge = deps.nudge ?? (async (_project: string, _session: string, _text: string) => 'no-tmux' as const);
  const stampNudge = deps.stampNudge ?? stampMissionNudge;
  const now = deps.now ?? Date.now();
  const cooldownMs = deps.cooldownMs ?? MISSION_NUDGE_COOLDOWN_MS;
  const escalationMs = deps.escalationMs ?? MISSION_NUDGE_ESCALATION_MS;

  const result: MissionLoopResult = { project, nudged: [], skipped: 0, stalled: [], overBudget: [] };

  let missions: MissionSummary[];
  try { missions = list(project); } catch { return result; }

  for (const m of missions) {
    const session = m.ownerSession ?? m.assigneeSession ?? null;
    const action = planMissionLoopStep({
      mission: {
        todoId: m.node.id, status: m.mission.status ?? 'needs-discovery',
        lastNudgeAt: m.mission.lastNudgeAt ?? null, lastNudgeKey: m.mission.lastNudgeKey ?? null,
        title: m.node.title, active: m.mission.active !== false,
      },
      rollup: { capability: m.rollup.capability },
      ownerSession: session,
      idle: session ? isIdle(project, session) : false,
      now,
      cooldownMs,
      escalationMs,
    });

    try {
      if (action.kind === 'nudge') {
        // A nudge IS motion — the mission is being driven, so any stall episode ends here.
        clearMissionStall(project, m.node.id);
        await nudge(project, action.session, action.message);
        stampNudge(project, m.node.id, action.key);
        result.nudged.push(m.node.id);
      } else {
        // NO SILENT STOP: classify this no-op and, if it means the mission is stuck,
        // make it visible (stall clock → derived status → exactly one human card).
        handleNoneReason(project, m, action.reason, now, deps, result);
        result.skipped++;
      }
    } catch {
      result.skipped++; // never let one mission break the pass
    }
  }
  return result;
}
