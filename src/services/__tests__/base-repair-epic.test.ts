import { describe, test, expect } from 'bun:test';

import {
  baseRepairMarker,
  baseRepairLaneKey,
  baseRepairLaneMarker,
  BASE_REPAIR_ATTEMPT_CAP,
  BASE_REPAIR_WINDOW_MS,
  findBaseRepairEpics,
  buildRepairLeafSpec,
  raiseBaseRepairEpic,
  type RaiseBaseRepairArgs,
  type RaiseBaseRepairIo,
} from '../base-repair-epic';
import { type Todo } from '../todo-store';
import { derivedStatus, isClaimable, claimReason } from '../claimability';

describe('baseRepairMarker', () => {
  test('formats as [base-repair:epicId8:laneSig8]', () => {
    const marker = baseRepairMarker('abcd1234efgh5678', 'xyz9876510111213');
    expect(marker).toBe('[base-repair:abcd1234:xyz98765]');
  });
});

describe('BASE_REPAIR_ATTEMPT_CAP', () => {
  test('is 2', () => {
    expect(BASE_REPAIR_ATTEMPT_CAP).toBe(2);
  });
});

describe('BASE_REPAIR_WINDOW_MS', () => {
  test('is a positive number (reprobe TTL)', () => {
    expect(BASE_REPAIR_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe('buildRepairLeafSpec', () => {
  test('includes the marker and exact prohibition string', () => {
    const marker = '[base-repair:12345678:abcdef12]';
    const spec = buildRepairLeafSpec({
      marker,
      cause: 'epic-base-red',
      reasonTail: 'tsc error in src/foo.ts',
      epicBranch: 'epic-fix-foo-bug',
    });

    expect(spec).toContain(marker);
    expect(spec).toContain('do NOT weaken, skip or delete a test that catches a real gap — park and escalate instead');
    expect(spec).toContain('fixing the net-new failing test');
  });

  test('includes epicBranch, cause, and reasonTail truncated to ~2000 chars', () => {
    const reasonTail = 'x'.repeat(3000);
    const spec = buildRepairLeafSpec({
      marker: '[base-repair:12345678:abcdef12]',
      cause: 'epic-base-red',
      reasonTail,
      epicBranch: 'my-epic-branch',
    });

    expect(spec).toContain('my-epic-branch');
    expect(spec).toContain('epic-base-red');
    // Verify tail is truncated: spec has ~2000 chars of the 3000
    expect(spec.length).toBeLessThan(reasonTail.length);
  });
});

describe('findBaseRepairEpics', () => {
  const marker = '[base-repair:12345678:abcdef12]';

  test('partitions open vs attempts-in-window by status and age', () => {
    const now = Date.now();
    const todos: Todo[] = [
      {
        id: 'open-epic',
        kind: 'epic',
        title: 'Open repair',
        status: 'ready',
        description: 'prefix ' + marker,
        baseRepair: 1,
        createdAt: now,
        updatedAt: now,
      } as unknown as Todo,
      {
        id: 'done-recent',
        kind: 'epic',
        title: 'Done recent',
        status: 'done',
        description: marker,
        baseRepair: 1,
        createdAt: now - BASE_REPAIR_WINDOW_MS / 2,
        updatedAt: now - BASE_REPAIR_WINDOW_MS / 2,
        completedAt: now - BASE_REPAIR_WINDOW_MS / 2,
      } as unknown as Todo,
      {
        id: 'done-old',
        kind: 'epic',
        title: 'Done old',
        status: 'done',
        description: marker,
        baseRepair: 1,
        createdAt: now - BASE_REPAIR_WINDOW_MS * 2,
        updatedAt: now - BASE_REPAIR_WINDOW_MS * 2,
        completedAt: now - BASE_REPAIR_WINDOW_MS * 2,
      } as unknown as Todo,
      {
        id: 'not-repair-epic',
        kind: 'epic',
        title: 'Regular epic',
        status: 'ready',
        description: marker,
        baseRepair: 0,
        createdAt: now,
        updatedAt: now,
      } as unknown as Todo,
      {
        id: 'no-marker',
        kind: 'epic',
        title: 'No marker',
        status: 'ready',
        description: 'some other description',
        baseRepair: 1,
        createdAt: now,
        updatedAt: now,
      } as unknown as Todo,
    ];

    const result = findBaseRepairEpics(todos, marker, now);

    expect(result.open).toEqual(
      todos.filter((t) => t.id === 'open-epic'),
    );
    expect(result.attemptsInWindow).toEqual(
      todos.filter((t) => t.id === 'done-recent'),
    );
  });

  test('uses updatedAt when completedAt is missing', () => {
    const now = Date.now();
    const todos: Todo[] = [
      {
        id: 'done-no-completed-at',
        kind: 'epic',
        title: 'Done',
        status: 'done',
        description: marker,
        baseRepair: 1,
        createdAt: now,
        updatedAt: now - BASE_REPAIR_WINDOW_MS / 2,
        completedAt: undefined,
      } as unknown as Todo,
    ];

    const result = findBaseRepairEpics(todos, marker, now);
    expect(result.attemptsInWindow).toHaveLength(1);
  });
});

describe('raiseBaseRepairEpic', () => {
  test('returns already-in-flight when an open marked epic exists', async () => {
    const epicId = 'epic1234567890ab';
    const laneSig = 'abc123456def7890'; // 16 chars for the lane signature
    const laneMarker = baseRepairLaneMarker(baseRepairLaneKey('p1', 'master'));
    const todos: Todo[] = [
      {
        id: 'open-repair',
        kind: 'epic',
        title: 'Open repair',
        status: 'ready',
        description: laneMarker,
        baseRepair: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as Todo,
    ];

    const io: RaiseBaseRepairIo = {
      listTodos: () => todos,
    };

    const result = await raiseBaseRepairEpic(
      {
        project: 'p1',
        session: 's1',
        epicId,
        targetProject: 'p1',
        laneSignature: laneSig,
        trunkRef: 'master',
        cause: 'epic-base-red',
        reasonTail: 'reason',
        epicBranch: 'branch',
      },
      io,
    );

    expect(result).toEqual({ created: false, reason: 'already-in-flight' });
  });

  test('returns cap-reached when attempt cap is hit in the window', async () => {
    const now = Date.now();
    const epicId = 'epic1234567890ab';
    const laneSig = 'abc123456def7890';
    const laneMarker = baseRepairLaneMarker(baseRepairLaneKey('p1', 'master'));
    const todos: Todo[] = [
      {
        id: 'done1',
        kind: 'epic',
        title: 'Done 1',
        status: 'done',
        description: laneMarker,
        baseRepair: 1,
        createdAt: new Date(now - BASE_REPAIR_WINDOW_MS / 2).toISOString(),
        updatedAt: new Date(now - BASE_REPAIR_WINDOW_MS / 2).toISOString(),
        completedAt: new Date(now - BASE_REPAIR_WINDOW_MS / 2).toISOString(),
      } as unknown as Todo,
      {
        id: 'done2',
        kind: 'epic',
        title: 'Done 2',
        status: 'done',
        description: laneMarker,
        baseRepair: 1,
        createdAt: new Date(now - BASE_REPAIR_WINDOW_MS / 3).toISOString(),
        updatedAt: new Date(now - BASE_REPAIR_WINDOW_MS / 3).toISOString(),
        completedAt: new Date(now - BASE_REPAIR_WINDOW_MS / 3).toISOString(),
      } as unknown as Todo,
    ];

    const io: RaiseBaseRepairIo = {
      listTodos: () => todos,
      now: () => now,
    };

    const result = await raiseBaseRepairEpic(
      {
        project: 'p1',
        session: 's1',
        epicId,
        targetProject: 'p1',
        laneSignature: laneSig,
        trunkRef: 'master',
        cause: 'epic-base-red',
        reasonTail: 'reason',
        epicBranch: 'branch',
      },
      io,
    );

    expect(result).toEqual({ created: false, reason: 'cap-reached' });
  });

  test('creates and returns epic id when all conditions are clear', async () => {
    const todos: Todo[] = [];
    let createdEpic: { title: string; home: any; homeProvided: any; baseRepair: any; description: any } | null = null;
    let createdLeaves: any = null;
    let updatedTodo: { project: string; id: string; patch: unknown } | null = null;

    const io: RaiseBaseRepairIo = {
      listTodos: () => todos,
      createEpic: async (_project, _session, opts) => {
        createdEpic = opts as any;
        return { epic: { id: 'new-epic-id', kind: 'epic' } as any };
      },
      addLeaves: async (_project, _session, epicId, leaves) => {
        createdLeaves = { epicId, leaves };
        return { epicId, createdIds: ['leaf-id'] };
      },
      updateTodo: async (project, id, patch) => {
        updatedTodo = { project, id, patch };
        return {} as any;
      },
    };

    const epicId = 'epic1234567890ab';
    const laneSig = 'abc123456def7890';
    const expectedLaneMarker = baseRepairLaneMarker(baseRepairLaneKey('p1', 'master'));
    const expectedTargetMarker = `[base-repair-target:${epicId.slice(0, 8)}]`;

    const args: RaiseBaseRepairArgs = {
      project: 'p1',
      session: 's1',
      epicId,
      targetProject: 'p1',
      laneSignature: laneSig,
      trunkRef: 'master',
      cause: 'epic-base-red',
      reasonTail: 'detailed reason here',
      epicBranch: 'epic-my-feature',
      files: ['src/foo.ts'],
    };

    const result = await raiseBaseRepairEpic(args, io);

    expect(result).toEqual({ created: true, epicId: 'new-epic-id' });

    // Verify epic creation call
    expect(createdEpic).not.toBeNull();
    expect(createdEpic!.title).toBe('Base repair: epic-my-feature');
    expect(createdEpic!.home).toBeNull();
    expect(createdEpic!.homeProvided).toBe(true);
    expect(createdEpic!.baseRepair).toBe(true);
    expect(createdEpic!.description).toContain(expectedLaneMarker);
    expect(createdEpic!.description).toContain(expectedTargetMarker);

    // Verify leaf creation call
    expect(createdLeaves).not.toBeNull();
    expect(createdLeaves!.epicId).toBe('new-epic-id');
    expect(createdLeaves!.leaves).toHaveLength(1);
    const leaf = createdLeaves!.leaves[0];
    expect(leaf.title).toBe('Repair red base');
    expect(leaf.status).toBe('ready');
    expect(leaf.files).toEqual(['src/foo.ts']);
    expect(leaf.description).toContain('do NOT weaken, skip or delete a test that catches a real gap — park and escalate instead');

    // Verify the release call
    expect(updatedTodo).not.toBeNull();
    expect(updatedTodo!).toEqual({ project: 'p1', id: 'new-epic-id', patch: { status: 'ready' } });
  });

  test('releases the epic so its leaf clears parent-unreleased (mutation probe on the release call)', async () => {
    const now = Date.now();
    const epic: Todo = {
      id: 'new-epic-id',
      kind: 'epic',
      title: 'Base repair: epic-my-feature',
      status: 'ready',
      description: 'base repair epic',
      baseRepair: 1,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    } as unknown as Todo;
    const leaf: Todo = {
      id: 'leaf-id',
      kind: 'leaf',
      title: 'Repair red base',
      status: 'ready',
      parentId: 'new-epic-id',
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    } as unknown as Todo;

    const todos: Todo[] = [];

    const io: RaiseBaseRepairIo = {
      listTodos: () => todos,
      createEpic: async () => ({ epic: epic as any }),
      addLeaves: async (_project, _session, epicId, leaves) => {
        return { epicId, createdIds: ['leaf-id'] };
      },
      updateTodo: async (_project, id, patch) => {
        if (id === epic.id) {
          Object.assign(epic, patch, { approvedAt: now });
        }
        return epic as any;
      },
    };

    const epicId = 'epic1234567890ab';
    const laneSig = 'abc123456def7890';

    const result = await raiseBaseRepairEpic(
      {
        project: 'p1',
        session: 's1',
        epicId,
        targetProject: 'p1',
        laneSignature: laneSig,
        trunkRef: 'master',
        cause: 'epic-base-red',
        reasonTail: 'reason',
        epicBranch: 'epic-my-feature',
      },
      io,
    );
    expect(result.created).toBe(true);

    const byId = new Map<string, Todo>([[epic.id, epic], [leaf.id, leaf]]);

    expect(epic.approvedAt).not.toBeNull();
    expect(derivedStatus(epic, byId)).not.toBe('planned');
    expect(isClaimable(leaf, byId)).toBe(true);
    expect(claimReason(leaf, byId)).not.toBe('parent-unreleased');

    // Mutation probe: without the release patch applied, the leaf stays parent-unreleased.
    const unreleasedEpic: Todo = { ...epic, approvedAt: null } as unknown as Todo;
    const unreleasedById = new Map<string, Todo>([[unreleasedEpic.id, unreleasedEpic], [leaf.id, leaf]]);
    expect(claimReason(leaf, unreleasedById)).toBe('parent-unreleased');
  });

  test('dedupes across different epicId/laneSignature on the same targetProject+trunkRef lane', async () => {
    const todos: Todo[] = [];
    let createdEpicDesc = '';

    const io: RaiseBaseRepairIo = {
      listTodos: () => todos,
      createEpic: async (_project, _session, opts) => {
        createdEpicDesc = (opts as any).description;
        return { epic: { id: 'first-epic-id', kind: 'epic' } as any };
      },
      addLeaves: async (_project, _session, epicId) => ({ epicId, createdIds: ['leaf-id'] }),
      updateTodo: async () => ({} as any),
    };

    const firstResult = await raiseBaseRepairEpic(
      {
        project: 'p1',
        session: 's1',
        epicId: 'epicaaaa11111111',
        targetProject: 'p1',
        laneSignature: 'sigaaaa11111111',
        trunkRef: 'master',
        cause: 'epic-base-red',
        reasonTail: 'reason A',
        epicBranch: 'epic-a',
      },
      io,
    );

    expect(firstResult).toEqual({ created: true, epicId: 'first-epic-id' });

    // Feed the created epic back into the fixture, as the already-in-flight test does.
    todos.push({
      id: 'first-epic-id',
      kind: 'epic',
      title: 'Base repair: epic-a',
      status: 'ready',
      description: createdEpicDesc,
      baseRepair: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as Todo);

    const secondResult = await raiseBaseRepairEpic(
      {
        project: 'p1',
        session: 's1',
        epicId: 'epicbbbb22222222',
        targetProject: 'p1',
        laneSignature: 'sigbbbb22222222',
        trunkRef: 'master',
        cause: 'epic-base-red',
        reasonTail: 'reason B',
        epicBranch: 'epic-b',
      },
      io,
    );

    expect(secondResult).toEqual({ created: false, reason: 'already-in-flight' });
  });
});
