// Regression test for the "ledger read failure must not read as needs-discovery" fix.
// collectMissionStatusFacts degrades a listLeafRuns THROW to empty runs so it never crashes
// the hot getMission/getMissionRollup read path — but degrading all the way to "no runs" used
// to silently flip a mid-build mission/criterion to 'discover'/'needs-discovery', which would
// make the autonomous conductor re-file a duplicate serving epic for work already in flight
// (real spend). The fix: on a ledger-read failure, treat every OPEN serving epic as LIVE
// (building) instead — see mission-store.ts collectMissionStatusFacts.
//
// listLeafRuns must throw for every call in this file. Bun's mock.module needs to be
// registered BEFORE mission-store's static `import { listLeafRuns } from './ledger-stats.ts'`
// resolves, so the mock is placed between import statements in textual order — the same
// pattern used by mission-epic-parenting.test.ts:28-34 (there: '../claude-launch').
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, updateTodo, _closeProject } from '../todo-store';

mock.module('../ledger-stats', () => ({
  listLeafRuns: () => {
    throw new Error('ledger unavailable (test)');
  },
}));

import {
  upsertMission, getMission, addCriterion, deriveCriterionAction, collectMissionStatusFacts,
  deriveMissionStatus, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

async function makeMissionNode(title = '[MISSION] ledger-unavailable') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-ledger-unavailable-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-store: ledger-read failure fails toward LIVE, not discover', () => {
  test('a criterion served by an open (unlanded) epic stays building when the ledger throws', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    const crit = addCriterion(project, missionId, 'the gap');
    const epic = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: '[EPIC] serve the gap', kind: 'epic', parentId: missionId,
    });
    await updateTodo(project, epic.id, { servesCriterionId: crit.id, status: 'ready' });
    // No child leaf under the epic and no ledger runs reachable — under the OLD (pre-fix)
    // behavior this would degrade to servingEpicLive=false and the criterion would read
    // 'discover' (the conductor would re-file a duplicate epic for work that IS in flight).

    const facts = collectMissionStatusFacts(project, getMission(project, missionId)!);
    const cf = facts.criteria.find((c) => c.id === crit.id)!;
    expect(cf.servingEpicState).toBe('open');
    expect(cf.servingEpicLive).toBe(true); // forced live — ledger threw, epic is still open
    expect(deriveCriterionAction(cf)).toBe('building'); // NOT 'discover'

    expect(facts.hasBuildingLeaf).toBe(true); // forced live at the mission level too
    expect(deriveMissionStatus(facts)).toBe('building'); // NOT 'needs-discovery'
  });

  test('a mission with no open epics still reads needs-discovery when the ledger throws', async () => {
    // Ledger unavailability only forces LIVE for epics that are actually open — it must not
    // manufacture motion for a criterion with no serving epic at all.
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    addCriterion(project, missionId, 'ungapped, never served');

    const facts = collectMissionStatusFacts(project, getMission(project, missionId)!);
    expect(facts.hasBuildingLeaf).toBe(false);
    expect(deriveMissionStatus(facts)).toBe('needs-discovery');
  });

  test('getMission does not throw when the ledger read fails', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    addCriterion(project, missionId, 'a gap');
    expect(() => getMission(project, missionId)).not.toThrow();
    expect(getMission(project, missionId)!.status).toBeDefined();
  });
});
