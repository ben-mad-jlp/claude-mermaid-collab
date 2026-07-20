// Store-integration tests for reconcileLandedEpics — real project DB (mission-store.test.ts
// harness), injected git probe (epic-branch-status.test.ts style, no real repo needed).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
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
import { reconcileLandedEpics } from '../landed-epic-sweep';

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
