// Store-integration tests for reconcileLandedEpics — real project DB (mission-store.test.ts
// harness), injected git probe (epic-branch-status.test.ts style, no real repo needed).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, completeTodo, getTodo, stampEpicLandedAt, _closeProject,
} from '../todo-store';
import {
  upsertMission, addCriterion, setCriterionMet, listCriteria, listMissions, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { epicBranchName, type GitProbe } from '../epic-branch-status';
import { reconcileLandedEpics, gcEpicBranches, type BranchGcRunner } from '../landed-epic-sweep';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'landed-epic-sweep-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** Build a converged mission with one landed-but-undone-land-leaf epic. */
async function seedConvergedEpic() {
  const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] m', kind: 'mission' });
  upsertMission(project, mission.id);
  addCriterion(project, mission.id, 'crit A');
  for (const c of listCriteria(project, mission.id)) setCriterionMet(project, c.id, true);

  const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] land me', parentId: mission.id, kind: 'epic', status: 'planned' });
  await completeTodo(project, epic.id, 'accepted');
  // Simulate the prior land-commit stamp (normally set by the [LAND] leaf's own completion).
  stampEpicLandedAt(project, epic.id, new Date(0).toISOString());
  const land = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[LAND] land me → master', parentId: epic.id, kind: 'land', status: 'ready' });
  const epicWithLandedAt = getTodo(project, epic.id)!;
  return { mission, epic: epicWithLandedAt, land };
}

function probeFor(epicId: string): GitProbe {
  const branch = epicBranchName(epicId);
  return (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true } : { exists: false, ahead: null, behind: null, mergeable: null });
}

describe('reconcileLandedEpics', () => {
  test('first pass: stamps and completes the [LAND] leaf for a landed converged-mission epic', async () => {
    const { mission, epic, land } = await seedConvergedEpic();
    const missions = listMissions(project);
    expect(missions.find((m) => m.node.id === mission.id)?.mission.status).toBe('converged');

    const probe = probeFor(epic.id);
    const result = await reconcileLandedEpics(project, { probe });

    expect(result.reconciled).toContain(epic.id);
    const reloaded = getTodo(project, land.id);
    expect(reloaded?.status).toBe('done');
  });

  test('second pass: already-reconciled epic is a no-op (empty reconciled, no further writes)', async () => {
    const { epic, land } = await seedConvergedEpic();
    const probe = probeFor(epic.id);
    await reconcileLandedEpics(project, { probe });

    const before = getTodo(project, land.id);

    const result = await reconcileLandedEpics(project, { probe });
    expect(result.reconciled).toEqual([]);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    // Proves the short-circuit fired (no further completeTodo write): the land leaf's
    // updatedAt is byte-identical to its pre-second-pass value, not merely re-set to done.
    const after = getTodo(project, land.id);
    expect(after?.status).toBe('done');
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });
});

describe('gcEpicBranches', () => {
  test('ahead===0 branch of a TERMINAL epic is deleted and its tip SHA is logged to the recovery file', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] gc me', kind: 'epic', status: 'planned' });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true } : { exists: false, ahead: null, behind: null, mergeable: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => 'abc123',
      deleteBranch: (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: () => [],
      aheadCount: () => 0,
    };

    const result = gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toContain(branch);
    expect(result.flagged).toEqual([]);
    expect(deleteCalls).toEqual([branch]);

    const log = readFileSync(join(project, '.collab', 'pruned-branches-recovery.md'), 'utf8');
    expect(log).toContain(branch);
    expect(log).toContain('abc123');
  });

  test('LIVE epic (non-terminal) with ahead===0 branch is SKIPPED, never deleted', async () => {
    // Regression (2026-07-22): a brand-new epic branch forked from master is ahead===0
    // until its first accepted merge; GC deleted such branches out from under in-flight
    // leaves (c72e635c twice, 48a3cc6e with two leaves running, 234f0021 four times),
    // failing their worktree adds with "invalid reference" and burning re-dispatch attempts.
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] building', kind: 'epic', status: 'planned' });
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true } : { exists: false, ahead: null, behind: null, mergeable: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => 'live99',
      deleteBranch: (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: () => [],
      aheadCount: () => 0,
    };

    const result = gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toEqual([]);
    expect(result.flagged).toEqual([]);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(deleteCalls).toEqual([]);
  });

  test('optimistically-landed epic (landedAt set, still building) is SKIPPED, never deleted', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] optimistic', kind: 'epic', status: 'planned' });
    stampEpicLandedAt(project, epic.id, new Date().toISOString());
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true } : { exists: false, ahead: null, behind: null, mergeable: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => 'opt42',
      deleteBranch: (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: () => [],
      aheadCount: () => 0,
    };

    const result = gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toEqual([]);
    expect(deleteCalls).toEqual([]);
  });

  test('ahead>0 branch is flagged and left intact', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] keep me', kind: 'epic', status: 'planned' });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = (b) => (b === branch ? { exists: true, ahead: 1, behind: 0, mergeable: true } : { exists: false, ahead: null, behind: null, mergeable: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => 'def456',
      deleteBranch: (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: () => [],
      aheadCount: () => 0,
    };

    const result = gcEpicBranches(project, { probe, runner });

    expect(result.flagged).toContain(epic.id);
    expect(result.deleted).not.toContain(branch);
    expect(deleteCalls.filter((b) => b === branch)).toEqual([]);
  });

  test('ORPHAN branch (no epic todo) fully-on-master is GC\'d; ahead>0 orphan is flagged', async () => {
    // No epic todo exists for these refs → absent from report.epics; only reachable via listEpicBranches.
    const orphanClean = 'collab/epic/deadbeef';
    const orphanAhead = 'collab/epic/feed0000';
    const probe: GitProbe = () => ({ exists: false, ahead: null, behind: null, mergeable: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => 'cafe123',
      deleteBranch: (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: () => [orphanClean, orphanAhead],
      aheadCount: (b) => (b === orphanClean ? 0 : 2),
    };

    const result = gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toContain(orphanClean); // fully-on-master orphan deleted
    expect(deleteCalls).toEqual([orphanClean]);
    expect(result.flagged).toContain(orphanAhead); // ahead>0 orphan flagged, not deleted
    expect(result.deleted).not.toContain(orphanAhead);
    const log = readFileSync(join(project, '.collab', 'pruned-branches-recovery.md'), 'utf8');
    expect(log).toContain(orphanClean);
  });

  test('a live epic\'s branch surfacing in BOTH passes is processed exactly once (no double delete)', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] once', kind: 'epic', status: 'planned' });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);
    const probe: GitProbe = (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true } : { exists: false, ahead: null, behind: null, mergeable: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => 'aaa111',
      deleteBranch: (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: () => [branch], // the SAME branch also appears in the orphan enumeration
      aheadCount: () => 0,
    };

    const result = gcEpicBranches(project, { probe, runner });

    expect(deleteCalls).toEqual([branch]); // deleted exactly ONCE (handled-set dedup)
    expect(result.deleted.filter((b) => b === branch)).toHaveLength(1);
  });

  test('a fully-on-master branch held by a worktree is pruned BEFORE deletion', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] worktree-held', kind: 'epic', status: 'planned' });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);
    const probe: GitProbe = (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true } : { exists: false, ahead: null, behind: null, mergeable: null });
    const order: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => 'wt111',
      deleteBranch: (b) => { order.push('delete:' + b); return true; },
      listEpicBranches: () => [],
      aheadCount: () => 0,
      pruneWorktreeFor: (b) => { order.push('prune:' + b); },
    };

    const result = gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toContain(branch);
    expect(order).toEqual(['prune:' + branch, 'delete:' + branch]); // worktree pruned, THEN branch deleted
  });
});
