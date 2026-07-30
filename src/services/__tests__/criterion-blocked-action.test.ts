// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, completeTodo, _closeProject, stampEpicLandedAt } from '../todo-store';
import {
  addCriterion, setCriterionDependsOn, setCriterionVerdict, listCriteriaWithActions,
  getMissionRollup, removeCriterion, upsertMission, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  upsertMission(project, t.id);
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'criterion-blocked-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('deriveCriterionAction: blocked on unmet dependsOn', () => {
  test('a criterion with an unmet dependency derives blocked, not discover', async () => {
    const missionId = await makeMissionNode();
    const prereq = addCriterion(project, missionId, 'prereq criterion');
    const dependent = addCriterion(project, missionId, 'dependent criterion');
    setCriterionDependsOn(project, dependent.id, [prereq.id]);

    const actions = listCriteriaWithActions(project, missionId);
    const dependentAction = actions.find((a) => a.id === dependent.id);
    expect(dependentAction?.action).toBe('blocked');
  });

  test('a blocked criterion derives discover once its dependency is met', async () => {
    const missionId = await makeMissionNode();
    const prereq = addCriterion(project, missionId, 'prereq criterion');
    const dependent = addCriterion(project, missionId, 'dependent criterion');
    setCriterionDependsOn(project, dependent.id, [prereq.id]);

    setCriterionVerdict(project, prereq.id, {
      met: true,
      evidence: 'evidence',
      verifiedBy: 'test-judge',
      verifiedAtSha: 'abc123',
      evidencePaths: [],
    });

    const actions = listCriteriaWithActions(project, missionId);
    const dependentAction = actions.find((a) => a.id === dependent.id);
    expect(dependentAction?.action).toBe('discover');
  });

  test('getMissionRollup gaps excludes a blocked criterion and includes it once unblocked', async () => {
    const missionId = await makeMissionNode();
    const prereq = addCriterion(project, missionId, 'prereq criterion');
    const dependent = addCriterion(project, missionId, 'dependent criterion');
    setCriterionDependsOn(project, dependent.id, [prereq.id]);

    // Both criteria unmet: prereq is a real gap (discover); dependent is blocked, not a gap.
    let rollup = getMissionRollup(project, missionId);
    expect(rollup.gaps).toBe(1);

    setCriterionVerdict(project, prereq.id, {
      met: true,
      evidence: 'evidence',
      verifiedBy: 'test-judge',
      verifiedAtSha: 'abc123',
      evidencePaths: [],
    });

    rollup = getMissionRollup(project, missionId);
    expect(rollup.gaps).toBe(1); // dependent now unblocked and reads discover
  });

  test('removing an unmet dependency criterion unblocks its dependent', async () => {
    const missionId = await makeMissionNode();
    const prereq = addCriterion(project, missionId, 'prereq criterion');
    const dependent = addCriterion(project, missionId, 'dependent criterion');
    setCriterionDependsOn(project, dependent.id, [prereq.id]);

    let actions = listCriteriaWithActions(project, missionId);
    expect(actions.find((a) => a.id === dependent.id)?.action).toBe('blocked');

    removeCriterion(project, prereq.id);

    actions = listCriteriaWithActions(project, missionId);
    expect(actions.find((a) => a.id === dependent.id)?.action).toBe('discover');
  });

  test('a landed serving epic still derives verify even with an unmet dependency', async () => {
    const missionId = await makeMissionNode();
    const prereq = addCriterion(project, missionId, 'prereq criterion');
    const dependent = addCriterion(project, missionId, 'dependent criterion');
    setCriterionDependsOn(project, dependent.id, [prereq.id]);

    const epic = await createTodo(project, {
      ownerSession: 's1', title: '[EPIC] serves dependent', kind: 'epic', parentId: missionId,
      servesCriterionIds: [dependent.id],
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1', title: 'the proof leaf', kind: 'leaf', parentId: epic.id,
      servesCriterionIds: [dependent.id],
    });
    await completeTodo(project, leaf.id, 'accepted');
    stampEpicLandedAt(project, epic.id, new Date(0).toISOString());

    const actions = listCriteriaWithActions(project, missionId);
    const dependentAction = actions.find((a) => a.id === dependent.id);
    // prereq stays unmet (dependent has an unmet dependency), but the verify arm runs
    // before the blocked short-circuit in deriveCriterionAction.
    expect(dependentAction?.action).toBe('verify');
  });
});
