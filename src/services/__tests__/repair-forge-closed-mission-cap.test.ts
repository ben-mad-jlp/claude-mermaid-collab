// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// FIX: closed repair missions do not cap the next repair-forge pass.
//
// runRepairForgePass checks if there is already an open auto-forged repair mission
// (isMissionTerminal returns false and isAutoForgedRepairMission is true). If found,
// it returns reason: 'repair-mission-open' without forging a new mission.
//
// setMissionClosed sets mission.closedAt, and isMissionTerminal treats closedAt != null
// as terminal. This test pins that:
//
// 1. A forged repair mission can be closed with setMissionClosed (closing sets closedAt
//    and stamps the mission root todo to done via stampMissionTodoStatus).
// 2. After a closed mission, a fresh batch of citable items still forges (the cap does
//    not fire because isMissionTerminal now returns true).
//
// Hermetic: every test runs against a fresh mkdtemp project; no real .collab/*.db and no
// ~/.mermaid-collab access.

import { describe, test, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _closeProject,
  createTodo,
  getTodo,
} from '../todo-store';
import {
  listMissions,
  _resetMissionDbCache,
  setMissionClosed,
  isMissionTerminal,
} from '../mission-store';
import { ensureBucket } from '../bucket-registry';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { runRepairForgePass, _resetRepairForgeThrottle } from '../repair-mission-pass';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'repair-forge-closed-mission-cap-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('repair-forge closed mission cap', () => {
  it('setMissionClosed stamps the mission root todo done', async () => {
    _resetRepairForgeThrottle(project);
    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed 5 bugfix leaves (all citable).
    const leafIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const leaf = await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
      leafIds.push(leaf.id);
    }

    // Run the pass to forge a repair mission.
    const result = await runRepairForgePass(project, {
      threshold: 5,
      forge: forgeMission,
      createEscalation: () => ({ escalation: {} as any, isNew: true }),
    });

    // Verify the pass forged with reason 'forged'.
    expect(result.reason).toBe('forged');
    expect(result.forged).not.toBe(null);

    const missionId = result.forged!.missionId;

    // Verify the mission root todo exists and is not done yet.
    const missionBefore = getTodo(project, missionId)!;
    expect(missionBefore.kind).toBe('mission');
    expect(missionBefore.status).not.toBe('done');

    // Close the mission.
    setMissionClosed(project, missionId, Date.now(), { judge: 'test' });

    // Verify the mission root todo is stamped done.
    const missionAfter = getTodo(project, missionId)!;
    expect(missionAfter.status).toBe('done');

    // Verify the mission row has closedAt set (so isMissionTerminal will return true).
    const missions = listMissions(project);
    const closedMission = missions.find((m) => m.node.id === missionId);
    expect(closedMission).not.toBe(undefined);
    expect(closedMission!.mission.closedAt).not.toBe(null);
    expect(isMissionTerminal(closedMission!.mission)).toBe(true);
  });

  it('a CLOSED repair mission does not cap the next repair-forge pass', async () => {
    _resetRepairForgeThrottle(project);
    const bucketId = await ensureBucket(project, 'bugfix');

    // FIRST CYCLE: Create, forge, and close a mission
    // -------
    // Seed 5 bugfix leaves (all citable).
    const leafIds1: string[] = [];
    for (let i = 0; i < 5; i++) {
      const leaf = await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix First Batch ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans: `Fixed means criterion ${i + 1}`,
        },
      });
      leafIds1.push(leaf.id);
    }

    // Run the pass to forge a repair mission.
    const result1 = await runRepairForgePass(project, {
      threshold: 5,
      forge: forgeMission,
      createEscalation: () => ({ escalation: {} as any, isNew: true }),
    });

    // Verify the pass forged.
    expect(result1.reason).toBe('forged');
    expect(result1.forged).not.toBe(null);

    const missionId1 = result1.forged!.missionId;

    // Close the mission.
    setMissionClosed(project, missionId1, Date.now(), { judge: 'test' });

    // Verify the mission is now done and terminal.
    const missionAfterClose = getTodo(project, missionId1)!;
    expect(missionAfterClose.status).toBe('done');

    // SECOND CYCLE: Create fresh leaves and forge again
    // -------
    // Seed a FRESH batch of 5 leaves (with different specs to avoid accidental re-selection).
    const leafIds2: string[] = [];
    for (let i = 0; i < 5; i++) {
      const leaf = await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix Second Batch ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure BATCH2 ${i + 1}`,
          evidence: `/test/path/batch2-${i}.ts:10`,
          fixedMeans: `Fixed means for BATCH2 criterion ${i + 1}`,
        },
      });
      leafIds2.push(leaf.id);
    }

    // Reset throttle and run the pass again.
    _resetRepairForgeThrottle(project);
    const result2 = await runRepairForgePass(project, {
      threshold: 5,
      forge: forgeMission,
      createEscalation: () => ({ escalation: {} as any, isNew: true }),
    });

    // Verify the pass forged.
    expect(result2.reason).toBe('forged');
    expect(result2.forged).not.toBe(null);

    const missionId2 = result2.forged!.missionId;

    // Verify the new mission ID is different from the closed one.
    expect(missionId2).not.toBe(missionId1);
  });
});
