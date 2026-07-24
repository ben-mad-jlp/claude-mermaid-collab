import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getMissionSpend,
  missionTodoClosure,
  aggregateMissionSpend,
  sweepMissionSpendRows,
  _resetMissionSpendMemo,
  MISSION_SPEND_PAGE_ROWS,
  MISSION_SPEND_MAX_PAGES,
  type MissionSpendRow,
} from '../ledger-stats';
import type { ThinLedgerRow } from '../worker-ledger';
import { getMissionCost } from '../mission-cost';
import { createTodo, _closeProject } from '../todo-store';
import { upsertMission, collectMissionStatusFacts, _resetMissionDbCache } from '../mission-store';
import { recordNode, _closeLedgerDb } from '../worker-ledger';

const PROJECT = '/proj';

describe('missionTodoClosure', () => {
  test('BFS-walks parentId to arbitrary depth regardless of status/kind', () => {
    const todos = [
      { id: 'M', parentId: null },
      { id: 'E1', parentId: 'M' },
      { id: 'L1', parentId: 'E1' },
      { id: 'L1-split', parentId: 'L1' }, // depth-3: mission -> epic -> leaf -> auto-split child
      { id: 'other-mission', parentId: null },
      { id: 'other-epic', parentId: 'other-mission' },
    ];
    const ids = missionTodoClosure('M', todos);
    expect(ids.has('M')).toBe(true);
    expect(ids.has('E1')).toBe(true);
    expect(ids.has('L1')).toBe(true);
    expect(ids.has('L1-split')).toBe(true);
    expect(ids.has('other-mission')).toBe(false);
    expect(ids.has('other-epic')).toBe(false);
  });
});

describe('aggregateMissionSpend', () => {
  test('inclusion/exclusion rule over a synthetic fixture', () => {
    const ids = new Set(['M', 'E1', 'E2', 'L1', 'L2']);
    const rows: MissionSpendRow[] = [
      // E1 ready epic, leaf L1 with two runs
      { id: 1, project: PROJECT, todoId: 'L1', epicId: 'E1', leafId: 'L1', costUsd: 1, nodesSpent: 1 },
      { id: 2, project: PROJECT, todoId: 'L1', epicId: 'E1', leafId: 'L1', nodeKind: 'outcome', costUsd: 0, nodesSpent: 0 },
      { id: 3, project: PROJECT, todoId: 'L1', epicId: 'E1', leafId: 'L1', costUsd: 2, nodesSpent: 1 }, // second run
      // E2 dropped epic, leaf L2
      { id: 4, project: PROJECT, todoId: 'L2', epicId: 'E2', leafId: 'L2', costUsd: 4, nodesSpent: 1 },
      // mission-scoped conductor / planner rows keyed directly to missionId
      { id: 5, project: PROJECT, todoId: 'M', source: 'conductor', costUsd: 3, nodesSpent: 1 },
      { id: 6, project: PROJECT, todoId: 'M', source: 'planner', costUsd: 5, nodesSpent: 1 },
      // outcome marker (excluded even though in-closure)
      { id: 7, project: PROJECT, todoId: 'M', nodeKind: 'outcome', costUsd: 0, nodesSpent: 0 },
      // foreign project row (excluded)
      { id: 8, project: '/other', todoId: 'M', costUsd: 100, nodesSpent: 1 },
      // out-of-closure row (excluded)
      { id: 9, project: PROJECT, todoId: 'not-in-mission', costUsd: 100, nodesSpent: 1 },
    ];

    const spend = aggregateMissionSpend('M', ids, PROJECT, rows);

    expect(spend.missionId).toBe('M');
    expect(spend.rows).toBe(5); // rows 1,3,4,5,6 (2,7 are outcome markers; 8,9 out of scope)
    expect(spend.costUsd).toBeCloseTo(1 + 2 + 4 + 3 + 5);
    expect(spend.nodesSpent).toBe(1 + 1 + 1 + 1 + 1);
    expect(spend.byBucket.leaves).toBeCloseTo(1 + 2 + 4);
    expect(spend.byBucket.conductor).toBeCloseTo(3);
    expect(spend.byBucket.planner).toBeCloseTo(5);
    expect(spend.byBucket.forge).toBe(0);
    expect(spend.byBucket.verify).toBe(0);
    expect(spend.byBucket.other).toBe(0);
  });
});

describe('getMissionSpend', () => {
  test('drives the closure + query through injected deps', () => {
    const todos = [
      { id: 'M', parentId: null, kind: 'mission', status: 'ready' } as unknown as { id: string; parentId: string | null },
      { id: 'E1', parentId: 'M' } as unknown as { id: string; parentId: string | null },
      { id: 'E2', parentId: 'M' } as unknown as { id: string; parentId: string | null }, // dropped epic
      { id: 'L1', parentId: 'E1' } as unknown as { id: string; parentId: string | null },
      { id: 'L2', parentId: 'E2' } as unknown as { id: string; parentId: string | null },
    ];

    const rowsByKey: Record<string, MissionSpendRow[]> = {
      'todoId:L1': [
        { id: 1, project: PROJECT, todoId: 'L1', epicId: 'E1', leafId: 'L1', costUsd: 1, nodesSpent: 1 },
        { id: 2, project: PROJECT, todoId: 'L1', epicId: 'E1', leafId: 'L1', nodeKind: 'outcome', costUsd: 0, nodesSpent: 0 },
        { id: 3, project: PROJECT, todoId: 'L1', epicId: 'E1', leafId: 'L1', costUsd: 2, nodesSpent: 1 },
      ],
      'todoId:L2': [
        { id: 4, project: PROJECT, todoId: 'L2', epicId: 'E2', leafId: 'L2', costUsd: 4, nodesSpent: 1 },
      ],
      'todoId:M': [
        { id: 5, project: PROJECT, todoId: 'M', source: 'conductor', costUsd: 3, nodesSpent: 1 },
        { id: 6, project: PROJECT, todoId: 'M', source: 'planner', costUsd: 5, nodesSpent: 1 },
        { id: 7, project: PROJECT, todoId: 'M', nodeKind: 'outcome', costUsd: 0, nodesSpent: 0 },
        { id: 8, project: '/other', todoId: 'M', costUsd: 100, nodesSpent: 1 },
      ],
      'todoId:E1': [],
      'todoId:E2': [],
    };

    let listTodosCalledWith: unknown;
    const spend = getMissionSpend(PROJECT, 'M', {
      listTodos: ((_project: string, filter: unknown) => {
        listTodosCalledWith = filter;
        return todos;
      }) as unknown as typeof import('../todo-store').listTodos,
      queryRows: (ids: string[]) => {
        const byId = new Map<number, MissionSpendRow>();
        for (const id of ids) {
          for (const r of rowsByKey[`todoId:${id}`] ?? []) {
            if (r.id != null) byId.set(r.id, r);
          }
        }
        // also include an out-of-closure row to prove it's dropped downstream
        byId.set(9, { id: 9, project: PROJECT, todoId: 'not-in-mission', costUsd: 100, nodesSpent: 1 });
        return [...byId.values()];
      },
    });

    expect(listTodosCalledWith).toEqual({ includeCompleted: true, includeArchived: true });
    expect(spend.costUsd).toBeCloseTo(1 + 2 + 4 + 3 + 5);
    expect(spend.nodesSpent).toBe(5);
    expect(spend.rows).toBe(5);
    expect(spend.byBucket.leaves).toBeCloseTo(1 + 2 + 4);
    expect(spend.byBucket.conductor).toBeCloseTo(3);
    expect(spend.byBucket.planner).toBeCloseTo(5);
    expect(spend.byBucket.forge).toBe(0);
    expect(spend.byBucket.verify).toBe(0);
    expect(spend.byBucket.other).toBe(0);
  });
});

describe('sweepMissionSpendRows', () => {
  test('pages a project-scoped sweep, filtering to the closure — never a per-id query', () => {
    const ids = new Set(['M', 'E1', 'L1']);
    const page: ThinLedgerRow[] = [
      { id: 5, project: PROJECT, todoId: 'M', source: 'conductor', costUsd: 3, nodesSpent: 1, ts: 200 } as ThinLedgerRow,
      { id: 6, project: PROJECT, todoId: 'M', source: 'planner', costUsd: 5, nodesSpent: 1, ts: 190 } as ThinLedgerRow,
      // second attempt of leaf L1 — must be counted, not dropped as a stale run
      { id: 1, project: PROJECT, todoId: 'L1', epicId: 'E1', leafId: 'L1', costUsd: 1, nodesSpent: 1, ts: 180 } as ThinLedgerRow,
      { id: 3, project: PROJECT, todoId: 'L1', epicId: 'E1', leafId: 'L1', costUsd: 2, nodesSpent: 1, ts: 170 } as ThinLedgerRow,
      // dropped epic's leaf still counted (closure includes dropped epics)
      { id: 4, project: PROJECT, todoId: 'L2-dropped-epic-leaf', epicId: 'E1', costUsd: 4, nodesSpent: 1, ts: 160 } as ThinLedgerRow,
      { id: 2, project: PROJECT, todoId: 'L1', epicId: 'E1', leafId: 'L1', nodeKind: 'outcome', costUsd: 0, nodesSpent: 0, ts: 150 } as ThinLedgerRow,
      { id: 8, project: '/other', todoId: 'M', costUsd: 100, nodesSpent: 1, ts: 140 } as ThinLedgerRow,
      { id: 9, project: PROJECT, todoId: 'not-in-mission', costUsd: 100, nodesSpent: 1, ts: 130 } as ThinLedgerRow,
    ];
    let calls = 0;
    const calledWith: Array<{ project?: string; limit?: number; until?: number; todoId?: string; epicId?: string }> = [];
    const queryThin = ((q: { project?: string; limit?: number; until?: number; todoId?: string; epicId?: string }) => {
      calls += 1;
      calledWith.push(q);
      if (calls > 1) return [];
      // A real queryLedgerThin call is already project-scoped by its SQL WHERE clause —
      // mirror that here so the fixture behaves like the real query.
      return page.filter((r) => r.project === q.project);
    }) as unknown as typeof import('../worker-ledger').queryLedgerThin;

    const rows = sweepMissionSpendRows(PROJECT, ids, queryThin);

    expect(calls).toBeLessThanOrEqual(MISSION_SPEND_MAX_PAGES);
    for (const q of calledWith) {
      expect(q.project).toBe(PROJECT);
      expect(q.todoId).toBeUndefined();
      expect(q.epicId).toBeUndefined();
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.has(5)).toBe(true);
    expect(byId.has(6)).toBe(true);
    expect(byId.has(1)).toBe(true);
    expect(byId.has(3)).toBe(true);
    expect(byId.has(4)).toBe(true);
    // the outcome marker IS in-closure so the sweep keeps it — aggregateMissionSpend,
    // not the sweep, is the exclusion authority for it; only foreign-project and
    // out-of-closure rows must be dropped by the sweep itself.
    expect(byId.has(2)).toBe(true);
    expect(byId.has(8)).toBe(false);
    expect(byId.has(9)).toBe(false);
  });

  test('terminates on a full page of identical ts (the tie-guard)', () => {
    const ids = new Set(['M']);
    let calls = 0;
    const samePage: ThinLedgerRow[] = Array.from({ length: MISSION_SPEND_PAGE_ROWS }, (_, i) => ({
      id: i + 1,
      project: PROJECT,
      todoId: 'M',
      costUsd: 0,
      nodesSpent: 1,
      ts: 1000,
    })) as ThinLedgerRow[];
    const queryThin = (() => {
      calls += 1;
      return samePage;
    }) as unknown as typeof import('../worker-ledger').queryLedgerThin;

    const rows = sweepMissionSpendRows(PROJECT, ids, queryThin);

    // A full page never proves it's the last page by size alone — the sweep must fetch
    // one more page to discover it adds no new id before it can stop.
    expect(calls).toBe(2);
    expect(rows.length).toBe(MISSION_SPEND_PAGE_ROWS);
  });
});

describe('getMissionSpend — cross-reader agreement', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'mission-spend-'));
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

  test('getMissionCost, collectMissionStatusFacts and getMissionSpend cite the same number', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[MISSION] spend agreement',
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
      costUsd: 1.5,
      nodesSpent: 1,
    });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      nodeKind: 'outcome',
      costUsd: 0,
      nodesSpent: 0,
      leafOutcome: 'accepted',
    });
    recordNode({
      project,
      todoId: mission.id,
      session: 's1',
      source: 'conductor',
      nodeKind: 'conductor',
      costUsd: 0.75,
      nodesSpent: 1,
    });

    // upsertMission/createTodo calls above already resolved a MissionRow via getMission,
    // which itself reads getMissionSpend and can have memoized a stale (pre-ledger-write)
    // 0 within the 5s TTL — clear it so this assertion reads the post-write spend.
    _resetMissionSpendMemo();
    const spend = getMissionSpend(project, mission.id);
    const cost = getMissionCost(project, mission.id);
    const missionRow = upsertMission(project, mission.id, {});
    const facts = collectMissionStatusFacts(project, missionRow);

    expect(spend.costUsd).toBeCloseTo(1.5 + 0.75);
    expect(cost.costUsd).toBeCloseTo(spend.costUsd);
    expect(facts.spendUsd).toBeCloseTo(spend.costUsd);
  });
});
