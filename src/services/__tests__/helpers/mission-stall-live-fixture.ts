/**
 * mission-stall-live-fixture.ts — real-store fixture for driving the stall reachability
 * conjunction (mission-loop.ts's evaluateStallAndMaybeRaise) against `bun test`'s
 * bun:sqlite-backed stores. No `mock.module`: a real mission + criterion + serving epics,
 * shaped so `collectMissionStallFacts` / `evaluateMissionStall` read the exact facts a
 * caller asks for via `opts`.
 *
 * Modelled on mission-store.test.ts:747-770 (createTodo + upsertMission + addCriterion +
 * CRITERION_SERVE_CAP dropped serving epics to force an 'escalate' criterion action) and
 * planner-reconcile-live.test.ts's mkdtempSync project-dir pattern.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, updateTodo, _closeProject } from '../../todo-store';
import { upsertMission, addCriterion, CRITERION_SERVE_CAP, _resetMissionDbCache } from '../../mission-store';
import { recordStatus } from '../../session-status-store';

export interface StalledFixtureOpts {
  /** Create an extra unresolved 'discover' gap criterion (rollup.gaps > 0). */
  gaps?: number;
  /** Create an extra criterion sitting in 'verify' (landed, unverified). */
  awaitingVerify?: number;
  /** Create N extra live [EPIC] children in `in_progress` (epicsBuilding > 0). */
  epicsBuilding?: number;
  /** Create a live leaf under a building epic (leavesRunning > 0). */
  leavesRunning?: boolean;
  /** Create a `done` epic with `acceptanceStatus: 'pending'` (landInFlight > 0). */
  landInFlight?: boolean;
  /** Set mission.budgetUsd to a value already crossed by spend (budgetPaused). Left off
   *  by default — the live store's spend read is real, so this is not wired here; kept
   *  for interface completeness / future callers. */
  budgetPaused?: boolean;
  /** Owner session for the mission node. Pass `null` to leave the mission ownerless
   *  (drives planMissionLoopStep's 'no-owner-session' STALLED reason). Defaults to 's1'. */
  session?: string | null;
  /** Session status to record for `session` (recordStatus). `false` records 'working'
   *  (busy — not idle); anything else (default) records 'waiting' (idle). */
  sessionIdle?: boolean;
}

export interface StalledFixture {
  project: string;
  missionId: string;
  criterionId: string;
  cleanup(): void;
}

/**
 * Build a real project directory with a mission that has burned CRITERION_SERVE_CAP
 * serving epics on its one criterion (all dropped) — so `deriveCriterionAction` reads
 * `escalate`, giving `evaluateMissionStall` a non-empty `blockedCriterionIds`, the arm
 * the stall conjunction needs alongside all in-flight counters at zero.
 */
export async function makeStalledMissionProject(opts: StalledFixtureOpts = {}): Promise<StalledFixture> {
  const dir = mkdtempSync(join(tmpdir(), 'mission-stall-live-'));
  const prevEnv = process.env.MERMAID_SUPERVISOR_DIR;
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  const project = join(dir, 'p');

  const session = opts.session === undefined ? 's1' : opts.session;
  // ownerSession is NOT NULL in the todos schema — an ownerless mission (drives
  // planMissionLoopStep's 'no-owner-session' reason) is expressed as '' (falsy, so
  // `m.ownerSession ?? m.assigneeSession ?? null` in mission-loop.ts still reads null-ish).
  const ownerSessionForCreate = session ?? '';

  const m = await createTodo(project, {
    allowOrphan: true,
    ownerSession: ownerSessionForCreate,
    title: '[MISSION] Stall reachability fixture',
    kind: 'mission',
  });
  upsertMission(project, m.id);
  const missionId = m.id;

  const c1 = addCriterion(project, missionId, 'the one capability this fixture is stalled on');
  const criterionId = c1.id;

  // Burn the serve cap on c1's serving epics (all dropped → no live/landed serving epic,
  // but servedEpicCount >= CRITERION_SERVE_CAP) so deriveCriterionAction reads 'escalate'.
  for (let i = 0; i < CRITERION_SERVE_CAP; i++) {
    const e = await createTodo(project, {
      ownerSession: ownerSessionForCreate,
      title: `[EPIC] serve ${i}`,
      kind: 'epic',
      parentId: missionId,
      servesCriterionIds: [criterionId],
    });
    await updateTodo(project, e.id, { status: 'dropped' });
  }

  if ((opts.gaps ?? 0) > 0) {
    for (let i = 0; i < (opts.gaps ?? 0); i++) {
      addCriterion(project, missionId, `unserved gap criterion ${i}`);
    }
  }

  if ((opts.awaitingVerify ?? 0) > 0) {
    for (let i = 0; i < (opts.awaitingVerify ?? 0); i++) {
      const vc = addCriterion(project, missionId, `awaiting-verify criterion ${i}`);
      const e = await createTodo(project, {
        ownerSession: ownerSessionForCreate,
        title: `[EPIC] verify serve ${i}`,
        kind: 'epic',
        parentId: missionId,
        servesCriterionIds: [vc.id],
      });
      await createTodo(project, {
        ownerSession: ownerSessionForCreate,
        title: `land leaf ${i}`,
        kind: 'leaf',
        parentId: e.id,
      });
      await updateTodo(project, e.id, { status: 'done' });
    }
  }

  if ((opts.epicsBuilding ?? 0) > 0) {
    for (let i = 0; i < (opts.epicsBuilding ?? 0); i++) {
      await createTodo(project, {
        ownerSession: ownerSessionForCreate,
        title: `[EPIC] building ${i}`,
        kind: 'epic',
        parentId: missionId,
      });
    }
  }

  if (opts.leavesRunning) {
    const e = await createTodo(project, {
      ownerSession: ownerSessionForCreate,
      title: '[EPIC] with a live leaf',
      kind: 'epic',
      parentId: missionId,
    });
    await createTodo(project, {
      ownerSession: ownerSessionForCreate,
      title: 'a leaf being built',
      kind: 'leaf',
      parentId: e.id,
      status: 'in_progress',
    });
  }

  if (opts.landInFlight) {
    const e = await createTodo(project, {
      ownerSession: ownerSessionForCreate,
      title: '[EPIC] pending acceptance',
      kind: 'epic',
      parentId: missionId,
    });
    await updateTodo(project, e.id, { status: 'done', acceptanceStatus: 'pending' });
  }

  if (session) {
    recordStatus(project, session, opts.sessionIdle === false ? 'active' : 'waiting');
  }

  function cleanup(): void {
    _closeProject(project);
    _resetMissionDbCache(project);
    if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR;
    else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }

  return { project, missionId, criterionId, cleanup };
}
