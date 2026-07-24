import { describe, test, expect } from 'bun:test';
import {
  getMissionSpend,
  missionTodoClosure,
  aggregateMissionSpend,
  type MissionSpendRow,
} from '../ledger-stats';

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
