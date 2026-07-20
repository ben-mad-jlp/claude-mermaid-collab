// Hermetic-project tests covering same-pass mission promotion, two-run idempotence, and the
// approval gate for runLandedEpicSweep. Mirrors the harness of landed-epic-sweep.test.ts and
// the runLandedEpicSweep({ force: true, ... }) call shape from landed-epic-sweep-throttle.test.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, completeTodo, getTodo, stampEpicLandedAt, listTodos, _closeProject,
} from '../todo-store';
import {
  upsertMission, addCriterion, setCriterionMet, listCriteria, getMission,
  enqueueMission, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { epicBranchName, type GitProbe } from '../epic-branch-status';
import { findLandedAtDivergence } from '../invariant-check';
import { runLandedEpicSweep, _resetLandedEpicSweepThrottle, type BranchGcRunner } from '../landed-epic-sweep';

let project: string;

beforeEach(() => {
  _resetLandedEpicSweepThrottle();
  project = mkdtempSync(join(tmpdir(), 'landed-epic-sweep-activation-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** Seed a converged mission A with one reconcile-eligible epic (landed, land leaf ready). */
async function seedMissionA() {
  const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] a', kind: 'mission' });
  upsertMission(project, mission.id);
  addCriterion(project, mission.id, 'crit A');
  for (const c of listCriteria(project, mission.id)) setCriterionMet(project, c.id, true);

  const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] land me', parentId: mission.id, kind: 'epic', status: 'planned' });
  await completeTodo(project, epic.id, 'accepted');
  stampEpicLandedAt(project, epic.id, new Date(0).toISOString());
  const land = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[LAND] land me → master', parentId: epic.id, kind: 'land', status: 'ready' });
  return { mission, epic: getTodo(project, epic.id)!, land };
}

/** Seed mission B, queued behind mission A on the same session. */
async function seedMissionB(opts: { approved: boolean }) {
  const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] b', kind: 'mission' });
  upsertMission(project, mission.id, opts.approved ? {} : { awaitingApprovalSince: Date.now() });
  enqueueMission(project, mission.id);
  return mission;
}

function probeFor(epicId: string): GitProbe {
  const branch = epicBranchName(epicId);
  return (b) => (b === branch
    ? { exists: true, ahead: 0, behind: 0, mergeable: true }
    : { exists: false, ahead: null, behind: null, mergeable: null });
}

/** Stateful branch-GC runner: once a branch is deleted, a later revParse returns null,
 *  so a second sweep pass skips the already-GC'd branch instead of re-deleting it. */
function makeStatefulRunner(): BranchGcRunner {
  const deleted = new Set<string>();
  return {
    revParse: (branch) => (deleted.has(branch) ? null : `sha-${branch}`),
    deleteBranch: (branch) => { deleted.add(branch); return true; },
    listEpicBranches: () => [],
    aheadCount: () => 0,
  };
}

describe('runLandedEpicSweep: same-pass mission activation', () => {
  test('a queued approved mission is promoted and active within one sweep call', async () => {
    const { epic } = await seedMissionA();
    const missionB = await seedMissionB({ approved: true });

    const probe = probeFor(epic.id);
    const runner = makeStatefulRunner();

    const result = await runLandedEpicSweep(project, { force: true, probe, runner });

    expect(result.reconcile.reconciled).toContain(epic.id);
    expect(result.promoted).toContain(missionB.id);
    expect(getMission(project, missionB.id)?.active).toBe(true);
  });
});

describe('runLandedEpicSweep: two-run idempotence', () => {
  test('second sweep pass is a no-op and the landed-at divergence check stays clean', async () => {
    const { epic } = await seedMissionA();
    await seedMissionB({ approved: true });

    const probe = probeFor(epic.id);
    const runner = makeStatefulRunner();

    await runLandedEpicSweep(project, { force: true, probe, runner });
    const second = await runLandedEpicSweep(project, { force: true, probe, runner });

    expect(second.reconcile.reconciled).toEqual([]);
    expect(second.gc.deleted).toEqual([]);
    expect(second.promoted).toEqual([]);

    const todosAfter = listTodos(project, { includeCompleted: true });
    expect(findLandedAtDivergence(todosAfter)).toEqual([]);
  });
});

describe('runLandedEpicSweep: approval gate', () => {
  test('an unapproved queued mission is never promoted and stays inactive', async () => {
    const { epic } = await seedMissionA();
    const missionB = await seedMissionB({ approved: false });

    const probe = probeFor(epic.id);
    const runner = makeStatefulRunner();

    const result = await runLandedEpicSweep(project, { force: true, probe, runner });

    expect(result.promoted).not.toContain(missionB.id);
    expect(getMission(project, missionB.id)?.active).toBe(false);
  });
});
