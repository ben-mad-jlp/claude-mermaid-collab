import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleAPI } from '../api';
import { createTodo, _closeProject } from '../../services/todo-store';
import { upsertMission, _resetMissionDbCache } from '../../services/mission-store';
import { getMissionSpend, _resetMissionSpendMemo } from '../../services/ledger-stats';
import { recordNode, _closeLedgerDb } from '../../services/worker-ledger';

const ws = { broadcast() {} } as any;
async function get(qs: string): Promise<Response> {
  const req = new Request(`http://x/api/usage/mission?${qs}`);
  return handleAPI(req, null as any, null as any, null as any, null as any, null as any, ws, new URL(req.url));
}

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'usage-mission-route-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _resetMissionSpendMemo();
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('GET /api/usage/mission', () => {
  test('returns costUsd byte-identical to getMissionSpend, budgetUsd, and the six bucket keys', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[MISSION] usage route',
      kind: 'mission',
    });
    upsertMission(project, mission.id, { budgetUsd: 12.5 });
    const epic = await createTodo(project, {
      ownerSession: 's1',
      kind: 'epic',
      title: '[EPIC] one',
      parentId: mission.id,
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'leaf one',
      parentId: epic.id,
    });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      nodeKind: 'implement',
      costUsd: 1.5,
      nodesSpent: 1,
    });

    _resetMissionSpendMemo();
    const expected = getMissionSpend(project, mission.id);

    const res = await get(`project=${encodeURIComponent(project)}&missionId=${mission.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.costUsd).toBe(expected.costUsd);
    expect(body.budgetUsd).toBe(12.5);
    expect(Object.keys(body.byBucket).sort()).toEqual(['conductor', 'forge', 'leaves', 'other', 'planner', 'verify']);
  });

  test('a short (leading-8) missionId returns the same costUsd as the full id', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[MISSION] short id',
      kind: 'mission',
    });
    upsertMission(project, mission.id, {});
    const epic = await createTodo(project, {
      ownerSession: 's1',
      kind: 'epic',
      title: '[EPIC] one',
      parentId: mission.id,
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'leaf one',
      parentId: epic.id,
    });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      nodeKind: 'implement',
      costUsd: 2.25,
      nodesSpent: 1,
    });

    const fullRes = await get(`project=${encodeURIComponent(project)}&missionId=${mission.id}`);
    const shortRes = await get(`project=${encodeURIComponent(project)}&missionId=${mission.id.slice(0, 8)}`);
    const fullBody = await fullRes.json() as any;
    const shortBody = await shortRes.json() as any;
    expect(shortBody.costUsd).toBe(fullBody.costUsd);
  });

  test('missing missionId → 400', async () => {
    const res = await get(`project=${encodeURIComponent(project)}`);
    expect(res.status).toBe(400);
  });

  test('a syntactically valid but absent missionId → 404', async () => {
    const res = await get(`project=${encodeURIComponent(project)}&missionId=00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });
});
