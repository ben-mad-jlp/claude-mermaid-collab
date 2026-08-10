// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, _closeProject, openDb } from '../todo-store';
import { addCriterion, listCriteria, removeCriterion, setCriterionDependsOn, _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'criterion-depends-on-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-store: criterion dependsOn', () => {
  test('rejects a cycle across two criteria and leaves the closing edge unwritten', async () => {
    const missionId = await makeMissionNode();
    const a = addCriterion(project, missionId, 'A');
    const b = addCriterion(project, missionId, 'B');
    setCriterionDependsOn(project, a.id, [b.id]);
    expect(() => setCriterionDependsOn(project, b.id, [a.id])).toThrow(/criterion-dependency-cycle/);
  });

  test('a rejected write does not persist', async () => {
    const missionId = await makeMissionNode();
    const a = addCriterion(project, missionId, 'A');
    const b = addCriterion(project, missionId, 'B');
    setCriterionDependsOn(project, a.id, [b.id]);
    expect(() => setCriterionDependsOn(project, b.id, [a.id])).toThrow(/criterion-dependency-cycle/);
    const found = listCriteria(project, missionId).find((c) => c.id === b.id);
    expect(found?.dependsOn).toEqual([]);
  });

  test('rejects a self-edge with the same cycle reason', async () => {
    const missionId = await makeMissionNode();
    const a = addCriterion(project, missionId, 'A');
    expect(() => setCriterionDependsOn(project, a.id, [a.id])).toThrow(/criterion-dependency-cycle/);
  });

  test('rejects an unknown dependency id', async () => {
    const missionId = await makeMissionNode();
    const a = addCriterion(project, missionId, 'A');
    expect(() => setCriterionDependsOn(project, a.id, ['crit_nope'])).toThrow(/criterion-dependency-unknown/);
  });

  test('removing a dependency strips it from dependents', async () => {
    const missionId = await makeMissionNode();
    const a = addCriterion(project, missionId, 'A');
    const b = addCriterion(project, missionId, 'B');
    setCriterionDependsOn(project, a.id, [b.id]);
    removeCriterion(project, b.id);
    const found = listCriteria(project, missionId).find((c) => c.id === a.id);
    expect(found?.dependsOn).toEqual([]);
  });

  test('a pre-migration row with no dependsOn column reads back an empty array', async () => {
    const missionId = await makeMissionNode();
    const a = addCriterion(project, missionId, 'A');
    // Simulate a legacy row whose dependsOn was never populated (empty string, as a
    // NOT NULL DEFAULT '[]' migration would backfill a value the reader still treats
    // as absent) — the falsy-JSON.parse-or-[] read path must tolerate it. Written through the
    // store's handle: criteria live in the consolidated collab.db, not a `.collab/mission.db`.
    openDb(project).exec(`UPDATE mission_criterion SET dependsOn = '' WHERE id = '${a.id}'`);
    _resetMissionDbCache(project);
    const found = listCriteria(project, missionId).find((c) => c.id === a.id);
    expect(found?.dependsOn).toEqual([]);
  });
});
