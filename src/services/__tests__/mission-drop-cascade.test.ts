// Integration test for the mission delete_mission → cascade-drop path: dropping a mission
// must terminalize every descendant (epics, land leaves, authored leaves), clear their
// claim fields, and remove them from claimability — all driven through the production
// MCP entrypoint, never a raw store/SQL call.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  getTodo,
  listTodos,
  listReadyTodos,
  _closeProject,
} from '../todo-store';
import type { Todo } from '../todo-store';
import { upsertMission, addCriterion, _resetMissionDbCache } from '../mission-store';
import { createEpicWithLandLeaf, addLeavesToEpic } from '../../mcp/workgraph-tools';
import { handleMissionTool } from '../../mcp/mission-tools';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-drop-cascade-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** Build mission + 2 criteria + 2 epics (each with an auto-minted [LAND] leaf) + 4 authored leaves. */
async function buildFixture() {
  const session = 's1';
  const mission = await createTodo(project, {
    allowOrphan: true,
    ownerSession: session,
    title: 'Converge on X',
    kind: 'mission',
  });
  upsertMission(project, mission.id);

  const critA = addCriterion(project, mission.id, 'Criterion A is satisfied');
  const critB = addCriterion(project, mission.id, 'Criterion B is satisfied');

  const { epic: epicA } = await createEpicWithLandLeaf(project, session, {
    title: 'Deliverable A',
    home: mission.id,
    homeProvided: true,
    servesCriterionIds: [critA.id],
  });
  const { epic: epicB } = await createEpicWithLandLeaf(project, session, {
    title: 'Deliverable B',
    home: mission.id,
    homeProvided: true,
    servesCriterionIds: [critB.id],
  });

  const { createdIds: leavesA } = await addLeavesToEpic(project, session, epicA.id, [
    { title: 'leaf A1' },
    { title: 'leaf A2' },
  ]);
  const { createdIds: leavesB } = await addLeavesToEpic(project, session, epicB.id, [
    { title: 'leaf B1' },
    { title: 'leaf B2' },
  ]);

  return { mission, epicA, epicB, leafIds: [...leavesA, ...leavesB] };
}

/** Walk `parentId` upward to find whether `todo` descends from `ancestorId`. */
function descendsFrom(todo: Todo, ancestorId: string, byId: Map<string, Todo>): boolean {
  let cur: Todo | undefined = todo;
  const seen = new Set<string>();
  while (cur && cur.parentId && !seen.has(cur.parentId)) {
    if (cur.parentId === ancestorId) return true;
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return false;
}

describe('delete_mission cascades every descendant to a terminal status', () => {
  test('delete_mission cascades every descendant to a terminal status', async () => {
    const { mission, epicA, epicB, leafIds } = await buildFixture();

    const result = await handleMissionTool('delete_mission', { project, todoId: mission.id });
    expect(result).not.toBeNull();

    expect(getTodo(project, mission.id)!.status).toBe('dropped');
    expect(getTodo(project, epicA.id)!.status).toBe('dropped');
    expect(getTodo(project, epicB.id)!.status).toBe('dropped');
    for (const id of leafIds) {
      expect(getTodo(project, id)!.status).toBe('dropped');
    }
  });
});

describe('no live child remains under the dropped mission subtree', () => {
  test('no live child remains under the dropped mission subtree', async () => {
    const { mission } = await buildFixture();

    await handleMissionTool('delete_mission', { project, todoId: mission.id });

    const all = listTodos(project, { includeCompleted: true });
    const byId = new Map(all.map((t) => [t.id, t]));
    const subtree = all.filter((t) => t.id === mission.id || descendsFrom(t, mission.id, byId));

    expect(subtree.length).toBeGreaterThan(0);
    const live = subtree.filter((t) => !['done', 'dropped'].includes(t.status));
    expect(live.length).toBe(0);
  });
});

describe('dropped leaves are excluded from listReadyTodos', () => {
  test('dropped leaves are excluded from listReadyTodos', async () => {
    const { mission, leafIds } = await buildFixture();

    await handleMissionTool('delete_mission', { project, todoId: mission.id });

    const readyIds = listReadyTodos(project).map((t) => t.id);
    for (const id of leafIds) {
      expect(readyIds).not.toContain(id);
    }
  });
});

describe('claim fields are cleared on cascaded descendants', () => {
  test('claim fields are cleared on cascaded descendants', async () => {
    const { mission, epicA, epicB, leafIds } = await buildFixture();

    await handleMissionTool('delete_mission', { project, todoId: mission.id });

    for (const id of [epicA.id, epicB.id, ...leafIds]) {
      const t = getTodo(project, id)!;
      expect(t.claimedBy).toBeNull();
      expect(t.claimToken).toBeNull();
      expect(t.claimedAt).toBeNull();
    }
  });
});

describe('the drop-path is the sole writer of the dropped-status cascade', () => {
  test('the drop-path is the sole writer of the dropped-status cascade', () => {
    const missionToolsPath = join(__dirname, '..', '..', 'mcp', 'mission-tools.ts');
    const todoStorePath = join(__dirname, '..', 'todo-store.ts');
    const files = [readFileSync(missionToolsPath, 'utf8'), readFileSync(todoStorePath, 'utf8')];

    expect(files.length).toBe(2);
    for (const content of files) {
      expect(content.length).toBeGreaterThan(0);
    }

    const [missionToolsSrc, todoStoreSrc] = files;
    const rawDropSql = /UPDATE\s+todos\s+SET\s+status\s*=\s*'dropped'/g;

    // Isolate the `case 'delete_mission':` block.
    const caseStart = missionToolsSrc.indexOf("case 'delete_mission':");
    expect(caseStart).toBeGreaterThan(-1);
    const afterCaseStart = missionToolsSrc.slice(caseStart + "case 'delete_mission':".length);
    const nextCaseIdx = afterCaseStart.indexOf("\n    case '");
    const caseSlice = nextCaseIdx > -1 ? afterCaseStart.slice(0, nextCaseIdx) : afterCaseStart;

    expect([...caseSlice.matchAll(rawDropSql)].length).toBe(0);

    // Locate the `updateTodo` function body by symbol-text search.
    const fnMarker = 'export function updateTodo(';
    const fnStart = todoStoreSrc.indexOf(fnMarker);
    expect(fnStart).toBeGreaterThan(-1);
    const afterFnStart = todoStoreSrc.slice(fnStart);
    const nextExportIdx = afterFnStart.indexOf('\nexport ', fnMarker.length);
    const fnSlice = nextExportIdx > -1 ? afterFnStart.slice(0, nextExportIdx) : afterFnStart;

    expect(fnSlice).toContain('DroppedEpicHasLiveChildrenError');

    // The cascade is written in exactly ONE place: the cascadeDropDescendants helper.
    // updateTodo must DELEGATE to it and hold no inline copy of the drop SQL — that
    // inline copy was the thing the other drop paths (resetTodo, sweepEpicRollups)
    // used to route around. Pin the delegation, not the old inline text.
    expect([...fnSlice.matchAll(rawDropSql)].length).toBe(0);
    expect(fnSlice).toContain('cascadeDropDescendants(');

    // The helper itself is the sole writer, and it drops via the recursive CTE.
    const helperMarker = 'function cascadeDropDescendants(';
    const helperStart = todoStoreSrc.indexOf(helperMarker);
    expect(helperStart).toBeGreaterThan(-1);
    // Top-level function: slice to its column-0 closing brace.
    const afterHelperStart = todoStoreSrc.slice(helperStart);
    const helperEnd = afterHelperStart.indexOf('\n}');
    expect(helperEnd).toBeGreaterThan(-1);
    const helperSlice = afterHelperStart.slice(0, helperEnd);

    const matches = [...helperSlice.matchAll(rawDropSql)];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(helperSlice).toContain('DESCENDANTS_CTE');

    // Every drop path reaches the cascade through the helper.
    for (const caller of ['export function resetTodo(', 'function sweepEpicRollups(']) {
      expect(todoStoreSrc).toContain(caller);
    }
    const callCount = [...todoStoreSrc.matchAll(/cascadeDropDescendants\(/g)].length;
    // 1 declaration + at least 3 call sites (updateTodo, sweepEpicRollups, resetTodo).
    expect(callCount).toBeGreaterThanOrEqual(4);
  });
});
