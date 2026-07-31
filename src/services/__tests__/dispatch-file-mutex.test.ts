import { test, expect, describe, beforeEach } from 'bun:test';
import type { Todo } from '../todo-store';
import { runTick, type CoordinatorDeps } from '../coordinator-daemon';
import { normaliseDeclaredPath, partitionByFileContention } from '../file-mutex';
import { reserveLeafSlot, releaseLeafSlot, _resetLeafSlots } from '../inflight-limiter';

const GLOBAL_CAP = 4;
const PROJECT_CAP = 4;

beforeEach(() => {
  process.env.MERMAID_MAX_INFLIGHT_GLOBAL = String(GLOBAL_CAP);
  process.env.MERMAID_MAX_INFLIGHT_PROJECT = String(PROJECT_CAP);
  _resetLeafSlots();
});

function makeTodo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    ownerSession: 'owner',
    assigneeSession: null,
    title: `Todo ${id}`,
    description: null,
    status: 'ready',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    blueprintId: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    retryCount: 0,
    declaredFiles: [],
    ...overrides,
  } as Todo;
}

interface Spy { claims: string[]; launches: string[]; }

function makeDeps(
  ready: Todo[],
  opts: { heldFilesFor?: (project: string) => Set<string> } = {},
): { deps: CoordinatorDeps; spy: Spy } {
  const spy: Spy = { claims: [], launches: [] };
  const deps: CoordinatorDeps = {
    listReadyTodos: () => ready,
    releaseExpiredClaims: async () => ({ released: [], exhausted: [] }),
    claimTodo: async (_p, id) => {
      const t = ready.find((r) => r.id === id) ?? makeTodo(id);
      spy.claims.push(id);
      return t;
    },
    launchWorker: async (_p, todo) => {
      spy.launches.push(todo.id);
      return true;
    },
    completeTodo: async (_p, id) => ({ completed: makeTodo(id), promoted: [] }),
    reserveLeafSlot,
    releaseLeafSlot,
    ...(opts.heldFilesFor ? { heldFilesFor: opts.heldFilesFor } : {}),
  };
  return { deps, spy };
}

describe('normaliseDeclaredPath', () => {
  test('strips a leading ./ and normalises backslashes to forward slashes', () => {
    expect(normaliseDeclaredPath('./src/foo.ts')).toBe('src/foo.ts');
    expect(normaliseDeclaredPath('src\\services\\foo.ts')).toBe('src/services/foo.ts');
    expect(normaliseDeclaredPath('./src\\foo.ts')).toBe('src/foo.ts');
  });
});

describe('partitionByFileContention', () => {
  test('same-file contention defers the second entry', () => {
    const a = makeTodo('a', { declaredFiles: ['src/x.ts'] });
    const b = makeTodo('b', { declaredFiles: ['src/x.ts'] });
    const held = new Set<string>();
    const { dispatch, deferred } = partitionByFileContention([a, b], held);
    expect(dispatch.map((t) => t.id)).toEqual(['a']);
    expect(deferred).toEqual([{ id: 'b', conflictFile: 'src/x.ts' }]);
  });

  test('disjoint files both dispatch', () => {
    const a = makeTodo('a', { declaredFiles: ['src/x.ts'] });
    const b = makeTodo('b', { declaredFiles: ['src/y.ts'] });
    const held = new Set<string>();
    const { dispatch, deferred } = partitionByFileContention([a, b], held);
    expect(dispatch.map((t) => t.id)).toEqual(['a', 'b']);
    expect(deferred).toEqual([]);
  });

  test('empty declaredFiles never defers', () => {
    const a = makeTodo('a', { declaredFiles: [] });
    const b = makeTodo('b', { declaredFiles: [] });
    const held = new Set<string>(['src/x.ts']);
    const { dispatch, deferred } = partitionByFileContention([a, b], held);
    expect(dispatch.map((t) => t.id)).toEqual(['a', 'b']);
    expect(deferred).toEqual([]);
  });
});

describe('runTick file-contention dispatch', () => {
  test('two ready leaves declaring the same file: only one dispatches this tick, the other stays ready', async () => {
    const a = makeTodo('a', { declaredFiles: ['src/services/conductor-pass.ts'] });
    const b = makeTodo('b', { declaredFiles: ['src/services/conductor-pass.ts'] });
    const { deps, spy } = makeDeps([a, b], { heldFilesFor: () => new Set() });
    const r = await runTick(deps, '/proj/A');
    expect(r.spawned).toEqual(['a']);
    expect(spy.claims).not.toContain('b');
    expect(spy.launches).not.toContain('b');

    // simulate 'a' still being in-flight: heldFilesFor now reports its file held.
    const { deps: deps2 } = makeDeps([b], { heldFilesFor: () => new Set(['src/services/conductor-pass.ts']) });
    const r2 = await runTick(deps2, '/proj/A');
    expect(r2.spawned).toEqual([]); // still deferred

    // once the held file clears, it dispatches.
    const { deps: deps3 } = makeDeps([b], { heldFilesFor: () => new Set() });
    const r3 = await runTick(deps3, '/proj/A');
    expect(r3.spawned).toEqual(['b']);
  });

  test('two ready leaves declaring disjoint files both dispatch in one tick', async () => {
    const a = makeTodo('a', { declaredFiles: ['src/services/x.ts'] });
    const b = makeTodo('b', { declaredFiles: ['src/services/y.ts'] });
    const { deps } = makeDeps([a, b], { heldFilesFor: () => new Set() });
    const r = await runTick(deps, '/proj/A');
    expect(r.spawned.sort()).toEqual(['a', 'b']);
  });

  test('two ready leaves with no declaredFiles both dispatch', async () => {
    const a = makeTodo('a', { declaredFiles: [] });
    const b = makeTodo('b', { declaredFiles: [] });
    const { deps } = makeDeps([a, b], { heldFilesFor: () => new Set() });
    const r = await runTick(deps, '/proj/A');
    expect(r.spawned.sort()).toEqual(['a', 'b']);
  });
});
