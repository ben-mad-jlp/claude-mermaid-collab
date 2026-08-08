// Forward-integration tests for reconcileLandedEpics with ahead>0 epics:
// when the epic's branch is ahead of master but its tree is identical (e.g., via revert-then-reapply
// or forward-integrate merge), the sweep should let the gate decide (via treeDelta predicate).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, completeTodo, getTodo, stampEpicLandedAt, _closeProject,
} from '../todo-store';
import {
  upsertMission, addCriterion, setCriterionMet, listMissions, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { epicBranchName, type GitProbe } from '../epic-branch-status';
import { reconcileLandedEpics } from '../landed-epic-sweep';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'landed-epic-sweep-forward-integrated-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** Build a converged mission with one landed-but-undone-land-leaf epic. */
async function seedConvergedEpic() {
  const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] m', kind: 'mission' });
  upsertMission(project, mission.id);
  addCriterion(project, mission.id, 'crit A');
  for (const c of listMissions(project).find((m) => m.node.id === mission.id)?.criteria || []) {
    setCriterionMet(project, c.id, true);
  }

  const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] land me', parentId: mission.id, kind: 'epic', status: 'planned' });
  // Create the land leaf BEFORE completing the epic (terminal-parent-approve constraint).
  const land = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[LAND] land me → master', parentId: epic.id, kind: 'land', status: 'todo' });
  await completeTodo(project, epic.id, 'accepted');
  // Simulate the prior land-commit stamp (normally set by the [LAND] leaf's own completion).
  stampEpicLandedAt(project, epic.id, new Date(0).toISOString());
  const epicWithLandedAt = getTodo(project, epic.id)!;
  return { mission, epic: epicWithLandedAt, land };
}

function probeForAhead2(epicId: string): GitProbe {
  const branch = epicBranchName(epicId);
  return async (b) =>
    b === branch
      ? { exists: true, ahead: 2, behind: 0, mergeable: true, newCount: 1 }
      : { exists: false, ahead: null, behind: null, mergeable: null, newCount: null };
}

describe('reconcileLandedEpics with forward-integrated ahead>0 epics', () => {
  test('ahead>0 with identical tree: epic is reconciled and its land leaf completes', async () => {
    const { epic, land } = await seedConvergedEpic();
    const probe = probeForAhead2(epic.id);

    // treeDelta resolves 'identical': tree has not changed despite the commits being ahead
    const treeDelta = async (
      _project: string,
      _epicId: string,
    ): Promise<'identical' | 'differs' | 'indeterminate'> => 'identical';

    const result = await reconcileLandedEpics(project, { probe, treeDelta });

    // Epic should be reconciled (tree identical despite being ahead)
    expect(result.reconciled).toContain(epic.id);
    // Land leaf should be completed
    const reloaded = getTodo(project, land.id);
    expect(reloaded?.status).toBe('done');
  });

  test('ahead>0 with differing tree: epic stays skipped and its land leaf stays open', async () => {
    const { epic, land } = await seedConvergedEpic();
    const probe = probeForAhead2(epic.id);

    // treeDelta resolves 'differs': tree has changed, epic is not yet reconcilable
    const treeDelta = async (
      _project: string,
      _epicId: string,
    ): Promise<'identical' | 'differs' | 'indeterminate'> => 'differs';

    const result = await reconcileLandedEpics(project, { probe, treeDelta });

    // Epic should NOT be reconciled (tree differs)
    expect(result.reconciled).not.toContain(epic.id);
    // Land leaf should remain open (not done)
    const reloaded = getTodo(project, land.id);
    expect(reloaded?.status).not.toBe('done');
  });
});
