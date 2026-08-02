import { describe, test, expect } from 'bun:test';

import { baseRepairMarker, baseRepairLaneMarker, baseRepairLaneKey, reapSettledBaseRepairEpics, reapRecoveredLaneBaseRepairEpics, type LaneIsGreenFn } from '../base-repair-epic';
import { type Todo } from '../todo-store';
import { type EpicBaseGateRow } from '../worker-ledger';

function makeRepairEpic(id: string, targetId: string, status: Todo['status'] = 'ready'): Todo {
  return {
    id,
    kind: 'epic',
    title: 'Base repair',
    status,
    description: baseRepairMarker(targetId, 'ab12cd34ef56'),
    baseRepair: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as Todo;
}

function makeTargetEpic(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    kind: 'epic',
    title: 'Target epic',
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as unknown as Todo;
}

describe('reapSettledBaseRepairEpics', () => {
  test('drops a repair epic whose target epic has landed (landedAt set)', async () => {
    const target = makeTargetEpic('aaaa1111', { landedAt: new Date().toISOString() });
    const repair = makeRepairEpic('repairepic01', target.id);

    const updateCalls: Array<[string, string, unknown]> = [];
    const reaped = await reapSettledBaseRepairEpics('proj', {
      listTodos: () => [repair, target],
      updateTodo: async (project, id, patch) => {
        updateCalls.push([project, id, patch]);
        return { ...repair, ...patch } as Todo;
      },
    });

    expect(reaped).toContain(repair.id);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toBe(repair.id);
    expect(updateCalls[0][2]).toEqual({ status: 'dropped' });
  });

  test('drops a repair epic whose target epic has status done', async () => {
    const target = makeTargetEpic('bbbb2222', { status: 'done' });
    const repair = makeRepairEpic('repairepic02', target.id);

    const reaped = await reapSettledBaseRepairEpics('proj', {
      listTodos: () => [repair, target],
      updateTodo: async (_project, _id, patch) => ({ ...repair, ...patch } as Todo),
    });

    expect(reaped).toContain(repair.id);
  });

  test('drops a repair epic whose target epic was dropped', async () => {
    const target = makeTargetEpic('cccc3333', { status: 'dropped' });
    const repair = makeRepairEpic('repairepic03', target.id);

    const reaped = await reapSettledBaseRepairEpics('proj', {
      listTodos: () => [repair, target],
      updateTodo: async (_project, _id, patch) => ({ ...repair, ...patch } as Todo),
    });

    expect(reaped).toContain(repair.id);
  });

  test('leaves a repair epic untouched when its target is still open', async () => {
    const target = makeTargetEpic('dddd4444', { status: 'ready' });
    const repair = makeRepairEpic('repairepic04', target.id);

    let updateCalled = false;
    const reaped = await reapSettledBaseRepairEpics('proj', {
      listTodos: () => [repair, target],
      updateTodo: async (_project, _id, patch) => {
        updateCalled = true;
        return { ...repair, ...patch } as Todo;
      },
    });

    expect(reaped).not.toContain(repair.id);
    expect(updateCalled).toBe(false);
  });

  test('resolves and reaps a legacy [base-repair:<epic8>:<lane8>] marker via the fallback regex', async () => {
    const target = makeTargetEpic('eeee5555', { landedAt: new Date().toISOString() });
    // makeRepairEpic embeds the LEGACY baseRepairMarker(targetId, laneSig) shape, not the
    // new [base-repair-target:...] tag — proves BASE_REPAIR_LEGACY_TARGET_RE still resolves it.
    const repair = makeRepairEpic('repairepic05', target.id);
    expect(repair.description).toBe(baseRepairMarker(target.id, 'ab12cd34ef56'));

    const reaped = await reapSettledBaseRepairEpics('proj', {
      listTodos: () => [repair, target],
      updateTodo: async (_project, _id, patch) => ({ ...repair, ...patch } as Todo),
    });

    expect(reaped).toContain(repair.id);
  });
});

describe('reapRecoveredLaneBaseRepairEpics', () => {
  function makeLaneRepairEpic(id: string, status: Todo['status'] = 'ready'): Todo {
    const laneMarker = baseRepairLaneMarker(baseRepairLaneKey('proj', 'master'));
    return {
      id,
      kind: 'epic',
      title: 'Base repair',
      status,
      description: laneMarker,
      baseRepair: 1,
      createdAt: Date.now() - 5000, // 5s ago
      updatedAt: Date.now(),
    } as unknown as Todo;
  }

  test('reapRecoveredLaneBaseRepairEpics drops an open lane-marked epic when the lane gate passed after its createdAt', async () => {
    const repair = makeLaneRepairEpic('repairepic10');
    const createdAtMs = typeof repair.createdAt === 'number' ? repair.createdAt : new Date(repair.createdAt as unknown as string).getTime();

    const reaped = await reapRecoveredLaneBaseRepairEpics('proj', {
      listTodos: () => [repair],
      updateTodo: async (_project, _id, patch) => ({ ...repair, ...patch } as Todo),
      laneIsGreen: async (project, sinceMs) => {
        expect(project).toBe('proj');
        expect(sinceMs).toBe(createdAtMs);
        return true;
      },
    });

    expect(reaped).toContain(repair.id);
  });

  test('reapRecoveredLaneBaseRepairEpics leaves the epic open when the only lane rows are fail', async () => {
    const repair = makeLaneRepairEpic('repairepic11');

    let updateCalled = false;
    const reaped = await reapRecoveredLaneBaseRepairEpics('proj', {
      listTodos: () => [repair],
      updateTodo: async (_project, _id, patch) => {
        updateCalled = true;
        return { ...repair, ...patch } as Todo;
      },
      laneIsGreen: async () => false, // No passing gates
    });

    expect(reaped).not.toContain(repair.id);
    expect(updateCalled).toBe(false);
  });

  test('reapRecoveredLaneBaseRepairEpics leaves the epic open when the sole pass row predates its createdAt', async () => {
    const createdAtMs = Date.now();
    const repair: Todo = {
      id: 'repairepic12',
      kind: 'epic',
      title: 'Base repair',
      status: 'ready',
      description: baseRepairLaneMarker(baseRepairLaneKey('proj', 'master')),
      baseRepair: 1,
      createdAt: createdAtMs,
      updatedAt: Date.now(),
    } as unknown as Todo;

    let updateCalled = false;
    const reaped = await reapRecoveredLaneBaseRepairEpics('proj', {
      listTodos: () => [repair],
      updateTodo: async (_project, _id, patch) => {
        updateCalled = true;
        return { ...repair, ...patch } as Todo;
      },
      laneIsGreen: async (project, sinceMs) => {
        // Pass exists but it predates the epic's creation
        expect(sinceMs).toBe(createdAtMs);
        return false;
      },
    });

    expect(reaped).not.toContain(repair.id);
    expect(updateCalled).toBe(false);
  });

  test('reapRecoveredLaneBaseRepairEpics reaps nothing when the laneIsGreen reader throws', async () => {
    const repair = makeLaneRepairEpic('repairepic13');

    let updateCalled = false;
    const reaped = await reapRecoveredLaneBaseRepairEpics('proj', {
      listTodos: () => [repair],
      updateTodo: async (_project, _id, patch) => {
        updateCalled = true;
        return { ...repair, ...patch } as Todo;
      },
      laneIsGreen: async () => {
        throw new Error('Reader broken');
      },
    });

    expect(reaped).not.toContain(repair.id);
    expect(updateCalled).toBe(false);
  });
});
