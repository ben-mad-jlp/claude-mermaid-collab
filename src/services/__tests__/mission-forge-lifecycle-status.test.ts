import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  upsertMission, getMission, setMissionForgeState, isMissionTerminal, deriveMissionStatus, deriveCheapMissionStatus,
  _resetMissionDbCache, type MissionStatusFacts,
} from '../mission-store';
import { createTodo, _closeProject } from '../todo-store';
import { handleSupervisorRoutes } from '../../routes/supervisor-routes';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-forge-lifecycle-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-forge-lifecycle-status: forging and forge-failed states', () => {
  test('deriveMissionStatus reads forging over unapproved', () => {
    const facts: MissionStatusFacts = {
      awaitingApproval: true,
      abandonedAt: null,
      closedAt: undefined,
      forgeState: 'forging',
      budgetUsd: null,
      spendUsd: 0,
      hasBlockedLeaf: false,
      hasBuildingLeaf: false,
      hasLandedEpic: false,
      hasOpenEpic: false,
      criteria: [],
    };
    expect(deriveMissionStatus(facts)).toBe('forging');
  });

  test('deriveMissionStatus reads forge-failed and isMissionTerminal is true', () => {
    const facts: MissionStatusFacts = {
      awaitingApproval: false,
      abandonedAt: null,
      closedAt: undefined,
      forgeState: 'forge-failed',
      budgetUsd: null,
      spendUsd: 0,
      hasBlockedLeaf: false,
      hasBuildingLeaf: false,
      hasLandedEpic: false,
      hasOpenEpic: false,
      criteria: [],
    };
    const status = deriveMissionStatus(facts);
    expect(status).toBe('forge-failed');
    expect(isMissionTerminal({ status, abandonedAt: null })).toBe(true);
  });

  test('deriveCheapMissionStatus reads forging and returns forging', () => {
    const status = deriveCheapMissionStatus(
      { abandonedAt: null, awaitingApprovalSince: null, forgeState: 'forging' },
      [],
      [],
    );
    expect(status).toBe('forging');
  });

  test('deriveCheapMissionStatus reads forge-failed and returns forge-failed', () => {
    const status = deriveCheapMissionStatus(
      { abandonedAt: null, awaitingApprovalSince: null, forgeState: 'forge-failed' },
      [],
      [],
    );
    expect(status).toBe('forge-failed');
  });

  test('GET /api/supervisor/missions reports a forging row as status forging', async () => {
    const node = await createTodo(project, {
      ownerSession: 's1',
      title: '[MISSION] Forging test',
      kind: 'mission',
    });
    const m = upsertMission(project, node.id);
    setMissionForgeState(project, node.id, 'forging');

    const req = new Request(`http://x/api/supervisor/missions?project=${encodeURIComponent(project)}`);
    const res = await handleSupervisorRoutes(req, new URL(req.url));
    expect(res!.status).toBe(200);
    const body = await res!.json() as any;
    const missionRow = body.missions.find((row: any) => row.node.id === node.id);
    expect(missionRow).toBeDefined();
    expect(missionRow.mission.status).toBe('forging');
  });

  test('GET /api/supervisor/missions reports a forge-failed row as status forge-failed and terminal', async () => {
    const node = await createTodo(project, {
      ownerSession: 's1',
      title: '[MISSION] Forge failed test',
      kind: 'mission',
    });
    upsertMission(project, node.id);
    setMissionForgeState(project, node.id, 'forge-failed');

    const req = new Request(`http://x/api/supervisor/missions?project=${encodeURIComponent(project)}`);
    const res = await handleSupervisorRoutes(req, new URL(req.url));
    expect(res!.status).toBe(200);
    const body = await res!.json() as any;
    const missionRow = body.missions.find((row: any) => row.node.id === node.id);
    expect(missionRow).toBeDefined();
    expect(missionRow.mission.status).toBe('forge-failed');
    expect(missionRow.rollup.stopped).toBe(true);
  });

  test('setMissionForgeState updates and persists forgeState', async () => {
    const node = await createTodo(project, {
      ownerSession: 's1',
      title: '[MISSION] Set forge state test',
      kind: 'mission',
    });
    upsertMission(project, node.id);

    // Initially null
    expect(getMission(project, node.id)!.forgeState).toBeNull();

    // Set to forging
    setMissionForgeState(project, node.id, 'forging');
    expect(getMission(project, node.id)!.forgeState).toBe('forging');

    // Set to forge-failed
    setMissionForgeState(project, node.id, 'forge-failed');
    expect(getMission(project, node.id)!.forgeState).toBe('forge-failed');

    // Clear to null
    setMissionForgeState(project, node.id, null);
    expect(getMission(project, node.id)!.forgeState).toBeNull();
  });

  test('forge-failed takes precedence over awaitingApproval in deriveMissionStatus', () => {
    const facts: MissionStatusFacts = {
      awaitingApproval: true,
      abandonedAt: null,
      closedAt: undefined,
      forgeState: 'forge-failed',
      budgetUsd: null,
      spendUsd: 0,
      hasBlockedLeaf: false,
      hasBuildingLeaf: false,
      hasLandedEpic: false,
      hasOpenEpic: false,
      criteria: [],
    };
    expect(deriveMissionStatus(facts)).toBe('forge-failed');
  });

  test('closedAt takes precedence over forge-failed in deriveMissionStatus', () => {
    const facts: MissionStatusFacts = {
      awaitingApproval: false,
      abandonedAt: null,
      closedAt: Date.now(),
      forgeState: 'forge-failed',
      budgetUsd: null,
      spendUsd: 0,
      hasBlockedLeaf: false,
      hasBuildingLeaf: false,
      hasLandedEpic: false,
      hasOpenEpic: false,
      criteria: [],
    };
    expect(deriveMissionStatus(facts)).toBe('closed');
  });

  test('upsertMission accepts forgeState option', async () => {
    const node = await createTodo(project, {
      ownerSession: 's1',
      title: '[MISSION] Upsert forge state',
      kind: 'mission',
    });
    const m = upsertMission(project, node.id, { forgeState: 'forging' });
    expect(m.forgeState).toBe('forging');
    expect(getMission(project, node.id)!.forgeState).toBe('forging');
  });
});
