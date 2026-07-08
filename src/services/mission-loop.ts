/**
 * mission-loop.ts — Phase 2b, slice 2: the ASSIST-mode mission driver.
 *
 * A per-watched-project orchestrator pass (mirrors runContextRecyclePass) that
 * advances convergence missions through the canonical loop
 * DISCOVER → PLAN → EXECUTE → VERIFY → (ITERATE) WITHOUT the steward hand-calling
 * advance_mission every time. It rides the same hybrid the article prescribes:
 *
 *   - EXECUTE is MECHANICAL → the daemon's Build pass already builds the mission's
 *     epic leaves; this pass just auto-advances EXECUTE→VERIFY once they're all done.
 *   - DISCOVER / PLAN / VERIFY are JUDGMENT → the pass NUDGES the steward session
 *     with a phase-specific instruction (VERIFY = run the independent /verify-mission
 *     gate). It does NOT auto-act on judgment phases in `assist` mode — the steward
 *     stays in the loop. (`auto` mode, slice 3, would auto-drive those too.)
 *
 * The STOP-WHEN guard (maxIterations) already lives in advanceMission, so the loop
 * can't run forever. Nudges are idle-gated (never disturb a busy session) and
 * debounced (lastNudgeAt cooldown) so the pass can't spam.
 *
 * `planMissionLoopStep` is PURE (no I/O) → fully unit-tested; the runner is a thin
 * apply-the-action shell over injectable deps.
 */

import type { MissionPhase, MissionSummary } from './mission-store.ts';
import { listMissions, advanceMission, stampMissionNudge, isTerminalPhase } from './mission-store.ts';
import { getStatus } from './session-status-store.ts';
import { nudgeSession } from './claude-launch.ts';

export const MISSION_NUDGE_COOLDOWN_MS = 15 * 60 * 1000; // 15 min between nudges per mission

export type MissionLoopAction =
  | { kind: 'none'; reason: string }
  | { kind: 'advance'; reason: string }
  | { kind: 'nudge'; session: string; message: string; reason: string };

export interface MissionLoopStepInput {
  mission: { todoId: string; phase: MissionPhase; iteration: number; lastNudgeAt: number | null; procedure: string | null; title: string; active: boolean };
  rollup: { converged: boolean; mechanical: { done: number; total: number }; capability: { met: number; total: number } };
  ownerSession: string | null;
  /** Is the steward session idle (safe to nudge without interrupting active work)? */
  idle: boolean;
  now: number;
  cooldownMs: number;
}

function goalOf(title: string): string {
  return title.replace(/^\s*\[MISSION\]\s*/i, '').trim() || 'mission';
}

function nudgeMessage(phase: MissionPhase, m: MissionLoopStepInput['mission'], rollup: MissionLoopStepInput['rollup']): string {
  const goal = goalOf(m.title);
  const proc = m.procedure ? `\nProcedure: ${m.procedure}` : '';
  switch (phase) {
    case 'discover':
      return `🎯 Mission «${goal}» is in DISCOVER (iteration ${m.iteration}). Exercise the app toward the goal, find the single highest-impact gap, and file it as an [EPIC] child of this mission. Then run advance_mission.${proc}`;
    case 'plan':
      return `🎯 Mission «${goal}» is in PLAN (iteration ${m.iteration}). Turn the gap into an [EPIC] + leaves under the mission and approve it (make it ready). Then advance_mission.`;
    case 'execute':
      return `🎯 Mission «${goal}» is in EXECUTE but has no epics to build (${rollup.mechanical.done}/${rollup.mechanical.total}). Add an [EPIC] child to build, or advance_mission past execute.`;
    case 'verify':
      return `🎯 Mission «${goal}» is in VERIFY (iteration ${m.iteration}). Run /verify-mission for this mission — the INDEPENDENT gate checks each criterion against ground truth (${rollup.capability.met}/${rollup.capability.total} currently met) and then advances (converge / stop / loop).`;
    default:
      return `🎯 Mission «${goal}» needs attention (phase ${phase}).`;
  }
}

/**
 * Decide the single action for one mission this tick. PURE.
 *  - inactive / terminal → none.
 *  - EXECUTE with all epics done → advance (mechanical EXECUTE→VERIFY).
 *  - EXECUTE still building → none (wait for the daemon).
 *  - judgment phase (discover/plan/verify, or execute-with-no-epics): nudge the
 *    steward — but only if idle + past the debounce cooldown + we have a session.
 *
 * Driving is gated by the mission's `active` flag (one active mission per session) —
 * NOT a per-project mode. The orchestrator only calls the pass for WATCHED projects,
 * which is the real safety boundary; this stays attended (nudge steward for judgment).
 */
export function planMissionLoopStep(input: MissionLoopStepInput): MissionLoopAction {
  const { mission, rollup, ownerSession, idle, now, cooldownMs } = input;
  if (!mission.active) return { kind: 'none', reason: 'inactive' }; // a session drives ONE mission
  if (isTerminalPhase(mission.phase)) return { kind: 'none', reason: `terminal:${mission.phase}` };

  // EXECUTE is mechanical: the daemon builds; auto-advance once the iteration's epics settle.
  if (mission.phase === 'execute' && rollup.mechanical.total > 0) {
    if (rollup.mechanical.done === rollup.mechanical.total) {
      return { kind: 'advance', reason: 'execute-epics-all-done' };
    }
    return { kind: 'none', reason: 'execute-building' };
  }

  // Judgment phases (+ execute-with-no-epics): nudge the steward, idle-gated + debounced.
  if (!ownerSession) return { kind: 'none', reason: 'no-owner-session' };
  if (!idle) return { kind: 'none', reason: 'session-busy' };
  if (mission.lastNudgeAt != null && now - mission.lastNudgeAt < cooldownMs) {
    return { kind: 'none', reason: 'nudge-cooldown' };
  }
  return {
    kind: 'nudge',
    session: ownerSession,
    message: nudgeMessage(mission.phase, mission, rollup),
    reason: `nudge:${mission.phase}`,
  };
}

export interface MissionLoopDeps {
  list?: (project: string) => MissionSummary[];
  isIdle?: (project: string, session: string) => boolean;
  advance?: (project: string, todoId: string) => unknown;
  nudge?: (project: string, session: string, text: string) => Promise<'sent' | 'busy' | 'no-tmux'>;
  stampNudge?: (project: string, todoId: string) => void;
  now?: number;
  cooldownMs?: number;
}

export interface MissionLoopResult {
  project: string;
  advanced: string[];
  nudged: string[];
  skipped: number;
}

/**
 * Run one mission-loop pass for a project. Drives the project's ACTIVE, non-terminal
 * missions (nudge steward for judgment phases, auto-advance mechanical EXECUTE→VERIFY).
 * The orchestrator only calls this for WATCHED projects — that + the mission `active`
 * flag are the gates; there is no per-project on/off mode.
 */
export async function runMissionLoopPass(project: string, deps: MissionLoopDeps = {}): Promise<MissionLoopResult> {
  const list = deps.list ?? listMissions;
  const isIdle = deps.isIdle ?? ((p: string, s: string) => getStatus(p, s)?.status === 'waiting');
  const advance = deps.advance ?? advanceMission;
  const nudge = deps.nudge ?? nudgeSession;
  const stampNudge = deps.stampNudge ?? stampMissionNudge;
  const now = deps.now ?? Date.now();
  const cooldownMs = deps.cooldownMs ?? MISSION_NUDGE_COOLDOWN_MS;

  const result: MissionLoopResult = { project, advanced: [], nudged: [], skipped: 0 };

  let missions: MissionSummary[];
  try { missions = list(project); } catch { return result; }

  for (const m of missions) {
    const session = m.ownerSession ?? m.assigneeSession ?? null;
    const action = planMissionLoopStep({
      mission: {
        todoId: m.node.id, phase: m.mission.phase, iteration: m.mission.iteration,
        lastNudgeAt: m.mission.lastNudgeAt ?? null, procedure: m.mission.procedure ?? null, title: m.node.title,
        active: m.mission.active !== false,
      },
      rollup: { converged: m.rollup.converged, mechanical: m.rollup.mechanical, capability: m.rollup.capability },
      ownerSession: session,
      idle: session ? isIdle(project, session) : false,
      now,
      cooldownMs,
    });

    try {
      if (action.kind === 'advance') {
        advance(project, m.node.id);
        result.advanced.push(m.node.id);
      } else if (action.kind === 'nudge') {
        await nudge(project, action.session, action.message);
        stampNudge(project, m.node.id);
        result.nudged.push(m.node.id);
      } else {
        result.skipped++;
      }
    } catch {
      result.skipped++; // never let one mission break the pass
    }
  }
  return result;
}
