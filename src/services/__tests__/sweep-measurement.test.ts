// Composed-primitive test for runSweepMeasurement — real project DB (mission-store.test.ts /
// landed-epic-sweep.test.ts harness), injected git probe + branch-GC runner sharing state
// across two consecutive calls to assert idempotence.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, completeTodo, stampEpicLandedAt, _closeProject } from '../todo-store';
import {
  upsertMission, addCriterion, setCriterionMet, listCriteria, enqueueMission,
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { epicBranchName, type GitProbe } from '../epic-branch-status';
import type { BranchGcRunner } from '../landed-epic-sweep';
import { runSweepMeasurement } from '../sweep-measurement';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'sweep-measurement-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('runSweepMeasurement', () => {
  test('composes promotion, landed-at divergence, GC, and queue-starvation over a seeded fixture, and is idempotent on replay', async () => {
    // 1. Converged mission A (s1) — terminal, so s1 reads with no active non-terminal mission.
    const aMission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] A', kind: 'mission' });
    upsertMission(project, aMission.id);
    addCriterion(project, aMission.id, 'crit');
    setCriterionMet(project, listCriteria(project, aMission.id)[0].id, true);

    // 2. Queued missions B and C (s1) — B enqueued first, gets the lower queuePos.
    const bMission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] B', kind: 'mission' });
    upsertMission(project, bMission.id);
    const cMission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] C', kind: 'mission' });
    upsertMission(project, cMission.id);
    enqueueMission(project, bMission.id);
    enqueueMission(project, cMission.id);

    // 3. Landed-at-divergence epic D — done [LAND] child, landedAt never stamped.
    const dEpic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] divergent', kind: 'epic', status: 'planned' });
    const land = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[LAND] divergent → master', parentId: dEpic.id, kind: 'land', status: 'planned' });
    await completeTodo(project, land.id, 'accepted');

    // 4. Fully-on-master branch epic G — no land leaf, GC acts purely on the probe.
    const gEpic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] gc me', kind: 'epic', status: 'planned' });

    const deletedBranches = new Set<string>();
    const gBranch = epicBranchName(gEpic.id);
    const probe: GitProbe = (b) => {
      if (deletedBranches.has(b)) return { exists: false, ahead: null, behind: null, mergeable: null };
      if (b === gBranch) return { exists: true, ahead: 0, behind: 0, mergeable: true };
      return { exists: false, ahead: null, behind: null, mergeable: null };
    };
    const runner: BranchGcRunner = {
      revParse: () => 'deadbeef',
      deleteBranch: (b) => { deletedBranches.add(b); return true; },
      listEpicBranches: () => [],
      aheadCount: () => 0,
    };

    const run1 = runSweepMeasurement(project, { probe, runner, baseRef: 'master' });

    expect(run1.promoted).toContain(bMission.id);
    expect(run1.promoted).not.toContain(cMission.id);
    expect(run1.sessionsZeroActiveWithQueuedApproved).toEqual([]);

    expect(run1.landedAtDivergence.count).toBe(1);
    expect(run1.landedAtDivergence.ids).toContain(dEpic.id);

    expect(run1.gcDeleted).toContain(gBranch);
    expect(run1.gcFlagged).toEqual([]);
    expect(run1.fullyOnMasterBranchesRemaining).toEqual([]);

    const run2 = runSweepMeasurement(project, { probe, runner, baseRef: 'master' });

    expect(run2.promoted).toEqual([]);
    expect(run2.gcDeleted).toEqual([]);
    expect(run2.gcFlagged).toEqual([]);
    expect(run2.fullyOnMasterBranchesRemaining).toEqual([]);
    expect(run2.sessionsZeroActiveWithQueuedApproved).toEqual([]);
    expect(run2.landedAtDivergence.count).toBe(run1.landedAtDivergence.count);
    expect(run2.landedAtDivergence.ids).toEqual(run1.landedAtDivergence.ids);
  });
});
