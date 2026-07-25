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
  // Create the land leaf BEFORE completing the epic (terminal-parent-approve constraint).
  const land = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[LAND] land me → master', parentId: epic.id, kind: 'land', status: 'todo' });
  await completeTodo(project, epic.id, 'accepted');
  // Simulate the prior land-commit stamp (normally set by the [LAND] leaf's own completion).
  stampEpicLandedAt(project, epic.id, new Date(0).toISOString());
  const epicWithLandedAt = getTodo(project, epic.id)!;
  return { mission, epic: epicWithLandedAt, land };
}

function probeFor(epicId: string): GitProbe {
  const branch = epicBranchName(epicId);
  return async (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 } : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
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

    const probe: GitProbe = async (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 } : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'abc123',
      deleteBranch: async (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: async () => [],
      aheadCount: async () => 0,
    };

    const result = await gcEpicBranches(project, { probe, runner });

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

    const probe: GitProbe = async (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 } : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'live99',
      deleteBranch: async (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: async () => [],
      aheadCount: async () => 0,
    };

    const result = await gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toEqual([]);
    expect(result.flagged).toEqual([]);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(deleteCalls).toEqual([]);
  });

  test('optimistically-landed epic (landedAt set, still building) is SKIPPED, never deleted', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] optimistic', kind: 'epic', status: 'planned' });
    stampEpicLandedAt(project, epic.id, new Date().toISOString());
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = async (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 } : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'opt42',
      deleteBranch: async (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: async () => [],
      aheadCount: async () => 0,
    };

    const result = await gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toEqual([]);
    expect(deleteCalls).toEqual([]);
  });

  test('ahead>0 branch is flagged and left intact', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] keep me', kind: 'epic', status: 'planned' });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = async (b) => (b === branch ? { exists: true, ahead: 1, behind: 0, mergeable: true, newCount: 1 } : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'def456',
      deleteBranch: async (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: async () => [],
      aheadCount: async () => 0,
    };

    const result = await gcEpicBranches(project, { probe, runner });

    expect(result.flagged).toContain(epic.id);
    expect(result.deleted).not.toContain(branch);
    expect(deleteCalls.filter((b) => b === branch)).toEqual([]);
  });

  test('ORPHAN branch (no epic todo) fully-on-master is GC\'d; ahead>0 orphan is flagged', async () => {
    // No epic todo exists for these refs → absent from report.epics; only reachable via listEpicBranches.
    const orphanClean = 'collab/epic/deadbeef';
    const orphanAhead = 'collab/epic/feed0000';
    const probe: GitProbe = async () => ({ exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'cafe123',
      deleteBranch: async (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: async () => [orphanClean, orphanAhead],
      aheadCount: async (b) => (b === orphanClean ? 0 : 2),
    };

    const result = await gcEpicBranches(project, { probe, runner });

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
    const probe: GitProbe = async (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 } : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'aaa111',
      deleteBranch: async (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: async () => [branch], // the SAME branch also appears in the orphan enumeration
      aheadCount: async () => 0,
    };

    const result = await gcEpicBranches(project, { probe, runner });

    expect(deleteCalls).toEqual([branch]); // deleted exactly ONCE (handled-set dedup)
    expect(result.deleted.filter((b) => b === branch)).toHaveLength(1);
  });

  test('a fully-on-master branch held by a worktree is pruned BEFORE deletion', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] worktree-held', kind: 'epic', status: 'planned' });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);
    const probe: GitProbe = async (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 } : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const order: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'wt111',
      deleteBranch: async (b) => { order.push('delete:' + b); return true; },
      listEpicBranches: async () => [],
      aheadCount: async () => 0,
      pruneWorktreeFor: async (b) => { order.push('prune:' + b); },
    };

    const result = await gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toContain(branch);
    expect(order).toEqual(['prune:' + branch, 'delete:' + branch]); // worktree pruned, THEN branch deleted
  });

  test('ahead>0 but newCount===0 (post-squash): branch IS deleted (new logic supersedes raw ahead)', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] squashed-clean', kind: 'epic', status: 'planned' });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = async (b) => (b === branch ? { exists: true, ahead: 5, behind: 0, mergeable: true, newCount: 0 } : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'sq000',
      deleteBranch: async (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: async () => [],
      aheadCount: async () => 5,
      newCount: async () => 0,
    };

    const result = await gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toContain(branch); // deleted because newCount===0 (not flagged like old ahead>0 would have)
    expect(result.flagged).not.toContain(epic.id);
    expect(deleteCalls).toContain(branch);
  });

  test('newCount>0 branch is flagged even if ahead===0 (new patches exist)', async () => {
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] new-patches', kind: 'epic', status: 'planned' });
    await completeTodo(project, epic.id, 'accepted');
    const branch = epicBranchName(epic.id);

    const probe: GitProbe = async (b) => (b === branch ? { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 2 } : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async (b) => { throw new Error('must not delete'); },
      deleteBranch: async (b) => { deleteCalls.push(b); throw new Error('must not delete'); },
      listEpicBranches: async () => [],
      aheadCount: async () => 0,
      newCount: async () => 2,
    };

    const result = await gcEpicBranches(project, { probe, runner });

    expect(result.flagged).toContain(epic.id); // flagged because newCount>0 (new patches exist)
    expect(result.deleted).not.toContain(branch); // not deleted
    expect(deleteCalls).toEqual([]); // delete never called
  });

  test('orphan branch with newCount>0 (or error -1) is flagged, not deleted', async () => {
    const orphanWithNewPatches = 'collab/epic/orphan01';
    const probe: GitProbe = async () => ({ exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'orphan1',
      deleteBranch: async (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: async () => [orphanWithNewPatches],
      aheadCount: async () => 0,
      newCount: async () => 1, // new patches exist
    };

    const result = await gcEpicBranches(project, { probe, runner });

    expect(result.flagged).toContain(orphanWithNewPatches); // flagged because newCount>0
    expect(result.deleted).not.toContain(orphanWithNewPatches); // not deleted
    expect(deleteCalls).toEqual([]);
  });

  test('orphan branch with newCount===0 (fully-on-master by cherry-pick): deleted', async () => {
    const orphanClean = 'collab/epic/orphan02';
    const probe: GitProbe = async () => ({ exists: false, ahead: null, behind: null, mergeable: null, newCount: null });
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: async () => 'orphan2',
      deleteBranch: async (b) => { deleteCalls.push(b); return true; },
      listEpicBranches: async () => [orphanClean],
      aheadCount: async () => 10, // raw ahead is nonzero...
      newCount: async () => 0, // ...but no new patches (post-squash)
    };

    const result = await gcEpicBranches(project, { probe, runner });

    expect(result.deleted).toContain(orphanClean); // deleted because newCount===0
    expect(result.flagged).not.toContain(orphanClean);
    expect(deleteCalls).toEqual([orphanClean]);
  });
});

// Crit-5 (watchdog starvation): the sweep halves accept an injected branch lister and
// pass it into buildEpicBranchStatus, so with the prefilter active the injected probe
// runs ONLY for epics whose branch actually exists — bounded by real branches, not the
// epic-todo count. GC correctness (live-epic guard, fail-closed ahead>0, recovery log)
// is untouched: branchless epics were skipped before and still are.
describe('crit-5 prefilter plumbing (listBranches)', () => {
  test('gcEpicBranches with listBranches: probe fires only for existing branches; many branchless epics probe-free', async () => {
    const kept = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] has-branch', kind: 'epic', status: 'planned' });
    await completeTodo(project, kept.id, 'accepted'); // terminal — past the live-epic guard, so ahead>0 flags
    for (let i = 0; i < 8; i++) {
      await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: `[EPIC] branchless ${i}`, kind: 'epic', status: 'planned' });
    }
    const branch = epicBranchName(kept.id);
    const probed: string[] = [];
    const probe: GitProbe = async (b) => {
      probed.push(b);
      return { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 2 }; // ahead>0/newCount>0 → flagged, never deleted
    };
    const runner: BranchGcRunner = {
      revParse: async () => 'sha1',
      deleteBranch: async () => { throw new Error('must not delete an ahead>0 branch'); },
      listEpicBranches: async () => [branch],
      aheadCount: async () => 2,
    };

    const result = await gcEpicBranches(project, { probe, runner, listBranches: async () => [branch] });

    expect(probed).toEqual([branch]); // 9 epic todos, 1 real branch → exactly 1 probe call
    expect(result.flagged).toContain(kept.id); // fail-closed flagging intact
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toBe(8); // branchless epics skipped, exactly as before
  });

  test('reconcileLandedEpics with listBranches: branchless epics are skipped without probing', async () => {
    // Own seed (land leaf created while the epic is still live, avoiding the
    // terminal-parent-approve trap that fails seedConvergedEpic on current master).
    const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] m2', kind: 'mission' });
    upsertMission(project, mission.id);
    addCriterion(project, mission.id, 'crit B');
    for (const c of listCriteria(project, mission.id)) setCriterionMet(project, c.id, true);
    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] pf', parentId: mission.id, kind: 'epic', status: 'planned' });
    await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[LAND] pf → master', parentId: epic.id, kind: 'land', status: 'todo' });
    await completeTodo(project, epic.id, 'accepted');
    stampEpicLandedAt(project, epic.id, new Date(0).toISOString());
    const branch = epicBranchName(epic.id);
    const probed: string[] = [];
    const probe: GitProbe = async (b) => {
      probed.push(b);
      return { exists: true, ahead: 0, behind: 0, mergeable: true, newCount: 0 };
    };

    const result = await reconcileLandedEpics(project, { probe, listBranches: async () => [branch] });

    expect(probed).toEqual([branch]); // mission todo + land leaf never probed; only the epic's real branch
    expect(result.reconciled).toContain(epic.id); // same outcome as the unfiltered pass
  });
});
