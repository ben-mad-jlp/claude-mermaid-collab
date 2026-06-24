// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFrictionTriagePass, type FrictionTriageDeps } from '../friction-triage';
import type { FrictionLayer } from '../friction-store';
import { _closeProject } from '../friction-store';
import type { Todo, CreateTodoInput } from '../todo-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'friction-triage-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

type TrendItem = { layer: FrictionLayer; retryReason: string; count: number };

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: overrides.id ?? 'todo-' + Math.random().toString(36).slice(2),
    ownerSession: '__steward_friction_triage__',
    assigneeSession: null,
    assigneeKind: null,
    title: overrides.title ?? 'Test todo',
    description: null,
    status: overrides.status ?? 'planned',
    priority: null,
    dueDate: null,
    parentId: overrides.parentId ?? null,
    dependsOn: [],
    link: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    objectRef: null,
    decisionRef: null,
    claimProbe: null,
    approvedAt: null,
    completedAt: null,
    claimedAt: null,
    claimReason: null,
    claimLease: null,
    claimBranch: null,
    claimWorktree: null,
    retryCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as Todo;
}

function makeDeps(
  trends: TrendItem[],
  existingTodos: Todo[] = [],
  opts: {
    actionedKeys?: Map<string, string>;
    threshold?: number;
    cap?: number;
  } = {},
): {
  deps: FrictionTriageDeps;
  created: Array<{ project: string; input: CreateTodoInput }>;
  actionedCalls: Array<{ project: string; layer: FrictionLayer; reason: string; todoId: string }>;
} {
  const created: Array<{ project: string; input: CreateTodoInput }> = [];
  const actionedCalls: Array<{ project: string; layer: FrictionLayer; reason: string; todoId: string }> = [];
  const todos: Todo[] = [...existingTodos];
  const actionedKeys = opts.actionedKeys ?? new Map<string, string>();

  const deps: FrictionTriageDeps = {
    trends: () => ({
      total: trends.length,
      considered: trends.length,
      byLayer: [],
      recurring: trends,
    }),
    listTodos: () => todos,
    createTodo: async (_p: string, input: CreateTodoInput) => {
      const todo = makeTodo({ ...input, id: 'created-' + created.length });
      todos.push(todo);
      created.push({ project: _p, input });
      return todo;
    },
    isActioned: (_p, layer, reason) => actionedKeys.has(`${layer}:${reason}`),
    markActioned: async (_p, layer, reason, todoId) => {
      actionedKeys.set(`${layer}:${reason}`, todoId);
      actionedCalls.push({ project: _p, layer, reason, todoId });
    },
    threshold: opts.threshold ?? 3,
    cap: opts.cap ?? 5,
  };

  return { deps, created, actionedCalls };
}

// ---------------------------------------------------------------------------
// 1. Threshold gate
// ---------------------------------------------------------------------------

describe('friction-triage: threshold gate', () => {
  it('files nothing when count < threshold', async () => {
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'missing-model', count: 2 },
    ], [], { threshold: 3 });

    await runFrictionTriagePass(project, deps);
    expect(created.length).toBe(0);
  });

  it('files exactly one todo when count === threshold', async () => {
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'missing-model', count: 3 },
    ], [], { threshold: 3 });

    await runFrictionTriagePass(project, deps);
    // One epic + one todo
    expect(created.filter((c) => c.input.parentId !== undefined && c.input.parentId !== null).length).toBe(1);
  });

  it('files nothing when all reasons are below threshold', async () => {
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'a', count: 1 },
      { layer: 'orchestration', retryReason: 'b', count: 2 },
    ], [], { threshold: 3 });

    await runFrictionTriagePass(project, deps);
    expect(created.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Layer routing
// ---------------------------------------------------------------------------

describe('friction-triage: layer routing', () => {
  it('routes domain friction to [EPIC] Bugfix inbox with category bug', async () => {
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'missing-model', count: 4 },
    ]);

    await runFrictionTriagePass(project, deps);

    const epicCreate = created.find((c) => /\[EPIC\]/i.test(c.input.title));
    expect(epicCreate?.input.title).toBe('[EPIC] Bugfix inbox');

    const todoCreate = created.find((c) => c.input.parentId != null);
    expect(todoCreate?.input.title).toContain('[bug]');
    expect(todoCreate?.input.title).toContain('missing-model');
  });

  it('routes orchestration friction to [EPIC] Collab gaps with category gap', async () => {
    const { deps, created } = makeDeps([
      { layer: 'orchestration', retryReason: 'gate-format', count: 4 },
    ]);

    await runFrictionTriagePass(project, deps);

    const epicCreate = created.find((c) => /\[EPIC\]/i.test(c.input.title));
    expect(epicCreate?.input.title).toBe('[EPIC] Collab gaps');

    const todoCreate = created.find((c) => c.input.parentId != null);
    expect(todoCreate?.input.title).toContain('[gap]');
  });

  it('routes operational friction to [EPIC] Collab gaps with category gap', async () => {
    const { deps, created } = makeDeps([
      { layer: 'operational', retryReason: 'unlanded-epics-over-threshold', count: 5 },
    ]);

    await runFrictionTriagePass(project, deps);

    const epicCreate = created.find((c) => /\[EPIC\]/i.test(c.input.title));
    expect(epicCreate?.input.title).toBe('[EPIC] Collab gaps');

    const todoCreate = created.find((c) => c.input.parentId != null);
    expect(todoCreate?.input.title).toContain('[gap]');
  });
});

// ---------------------------------------------------------------------------
// 3. Find-or-create epic
// ---------------------------------------------------------------------------

describe('friction-triage: find-or-create epic', () => {
  it('reuses an existing bucket epic, does not create a second one', async () => {
    const existingEpic = makeTodo({ id: 'epic-1', title: '[EPIC] Bugfix inbox', status: 'planned', parentId: null });
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'missing-model', count: 4 },
    ], [existingEpic]);

    await runFrictionTriagePass(project, deps);

    const epicCreates = created.filter((c) => /\[EPIC\]/i.test(c.input.title ?? ''));
    expect(epicCreates.length).toBe(0); // no new epic created

    const todoCreate = created.find((c) => c.input.parentId != null);
    expect(todoCreate?.input.parentId).toBe('epic-1');
  });

  it('creates the epic when it does not exist and uses its id as parentId', async () => {
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'missing-model', count: 4 },
    ]);

    await runFrictionTriagePass(project, deps);

    const epicCreate = created.find((c) => /\[EPIC\]/i.test(c.input.title ?? ''));
    expect(epicCreate).toBeDefined();
    expect(epicCreate?.input.status).toBe('planned');

    const todoCreate = created.find((c) => c.input.parentId != null);
    expect(todoCreate?.input.parentId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Dedup / actioned marker
// ---------------------------------------------------------------------------

describe('friction-triage: dedup / actioned marker', () => {
  it('skips a reason that is already actioned', async () => {
    const actionedKeys = new Map([['domain:missing-model', 'prev-todo']]);
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'missing-model', count: 5 },
    ], [], { actionedKeys });

    await runFrictionTriagePass(project, deps);
    expect(created.length).toBe(0);
  });

  it('calls markActioned with correct args after a successful file', async () => {
    const { deps, actionedCalls } = makeDeps([
      { layer: 'domain', retryReason: 'missing-model', count: 4 },
    ]);

    await runFrictionTriagePass(project, deps);

    expect(actionedCalls.length).toBe(1);
    expect(actionedCalls[0].layer).toBe('domain');
    expect(actionedCalls[0].reason).toBe('missing-model');
    expect(actionedCalls[0].todoId).toBeTruthy();
  });

  it('does not file again on a second pass once the marker is set', async () => {
    const actionedKeys = new Map<string, string>();
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'missing-model', count: 4 },
    ], [], { actionedKeys });

    await runFrictionTriagePass(project, deps);
    const firstRunCount = created.length;

    // Second pass: marker is now set
    await runFrictionTriagePass(project, deps);
    expect(created.length).toBe(firstRunCount); // nothing new
  });
});

// ---------------------------------------------------------------------------
// 5. Per-tick cap
// ---------------------------------------------------------------------------

describe('friction-triage: per-tick cap', () => {
  it('files at most `cap` todos per tick, highest-count first', async () => {
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'reason-a', count: 10 },
      { layer: 'domain', retryReason: 'reason-b', count: 8 },
      { layer: 'domain', retryReason: 'reason-c', count: 6 },
      { layer: 'domain', retryReason: 'reason-d', count: 5 },
      { layer: 'domain', retryReason: 'reason-e', count: 4 },
      { layer: 'domain', retryReason: 'reason-f', count: 3 },
    ], [], { cap: 3 });

    await runFrictionTriagePass(project, deps);

    const filedTodos = created.filter((c) => c.input.parentId != null);
    expect(filedTodos.length).toBe(3);
    // Highest counts filed first
    expect(filedTodos[0].input.title).toContain('reason-a');
    expect(filedTodos[1].input.title).toContain('reason-b');
    expect(filedTodos[2].input.title).toContain('reason-c');
  });
});

// ---------------------------------------------------------------------------
// 6. Filed status is always 'planned'
// ---------------------------------------------------------------------------

describe('friction-triage: filed status', () => {
  it('every filed todo has status planned', async () => {
    const { deps, created } = makeDeps([
      { layer: 'domain', retryReason: 'a', count: 4 },
      { layer: 'orchestration', retryReason: 'b', count: 3 },
    ]);

    await runFrictionTriagePass(project, deps);

    const todos = created.filter((c) => c.input.parentId != null);
    expect(todos.length).toBe(2);
    for (const t of todos) {
      expect(t.input.status).toBe('planned');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Fail-open: a throwing createTodo does not abort others
// ---------------------------------------------------------------------------

describe('friction-triage: fail-open', () => {
  it('continues filing other candidates when one createTodo throws', async () => {
    const actionedCalls: Array<{ layer: FrictionLayer; reason: string; todoId: string }> = [];
    let callCount = 0;
    const todos: Todo[] = [];

    const deps: FrictionTriageDeps = {
      trends: () => ({
        total: 2,
        considered: 2,
        byLayer: [],
        recurring: [
          { layer: 'domain' as FrictionLayer, retryReason: 'bad-one', count: 5 },
          { layer: 'domain' as FrictionLayer, retryReason: 'good-one', count: 4 },
        ],
      }),
      listTodos: () => todos,
      createTodo: async (_p, input) => {
        callCount++;
        if ((input.title ?? '').includes('bad-one')) throw new Error('simulated failure');
        const todo = makeTodo({ ...input, id: 'created-' + callCount });
        todos.push(todo);
        return todo;
      },
      isActioned: () => false,
      markActioned: async (_p, layer, reason, todoId) => {
        actionedCalls.push({ layer, reason, todoId });
      },
      threshold: 3,
      cap: 5,
    };

    await expect(runFrictionTriagePass(project, deps)).resolves.toBeUndefined();

    // The good-one should still be filed
    const goodFiled = actionedCalls.find((c) => c.reason === 'good-one');
    expect(goodFiled).toBeDefined();

    // The bad-one was NOT marked actioned (it failed before markActioned ran)
    const badFiled = actionedCalls.find((c) => c.reason === 'bad-one');
    expect(badFiled).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Real-store dedup integration (durable actioned marker)
// ---------------------------------------------------------------------------

describe('friction-triage: real-store dedup (integration)', () => {
  it('second pass files nothing — marker persists in friction.db (no-spam)', async () => {
    const todos: Todo[] = [];

    // Only stub trends/listTodos/createTodo; leave isActioned/markActioned unset
    // so friction-triage falls back to isReasonActioned/markReasonActioned (real DB).
    const deps: FrictionTriageDeps = {
      trends: () => ({
        total: 1,
        considered: 1,
        byLayer: [],
        recurring: [{ layer: 'domain' as FrictionLayer, retryReason: 'missing-model', count: 4 }],
      }),
      listTodos: () => todos,
      createTodo: async (_p, input) => {
        const todo = makeTodo({ ...input, id: 'created-' + todos.length });
        todos.push(todo);
        return todo;
      },
      threshold: 3,
    };

    await runFrictionTriagePass(project, deps);
    const afterPass1 = todos.filter((t) => t.parentId != null).length;
    expect(afterPass1).toBe(1);

    // Second pass against same project — real marker is in friction.db
    await runFrictionTriagePass(project, deps);
    const afterPass2 = todos.filter((t) => t.parentId != null).length;
    expect(afterPass2).toBe(1); // nothing new filed
  });

  it('marker survives a DB handle reopen (persisted on disk, not just cached)', async () => {
    const todos: Todo[] = [];

    const deps: FrictionTriageDeps = {
      trends: () => ({
        total: 1,
        considered: 1,
        byLayer: [],
        recurring: [{ layer: 'domain' as FrictionLayer, retryReason: 'missing-model-reopen', count: 5 }],
      }),
      listTodos: () => todos,
      createTodo: async (_p, input) => {
        const todo = makeTodo({ ...input, id: 'created-' + todos.length });
        todos.push(todo);
        return todo;
      },
      threshold: 3,
    };

    await runFrictionTriagePass(project, deps);
    expect(todos.filter((t) => t.parentId != null).length).toBe(1);

    // Drop the cached DB handle — next call opens a fresh handle from disk
    _closeProject(project);

    await runFrictionTriagePass(project, deps);
    expect(todos.filter((t) => t.parentId != null).length).toBe(1); // still only 1
  });
});
