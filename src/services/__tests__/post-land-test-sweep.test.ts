import { describe, it, expect } from 'bun:test';
import {
  newlyFailingNames,
  postLandSweepSignature,
  runPostLandTestSweep,
  type PostLandSweepDeps,
} from '../post-land-test-sweep.js';
import type { Todo } from '../todo-store.js';

describe('post-land-test-sweep', () => {
  // Helper to create a stub Todo with minimal required fields
  function createStubTodo(input: any): Todo {
    return {
      id: input.id || `t${Math.random()}`,
      ownerSession: input.ownerSession || '',
      assigneeSession: null,
      assigneeKind: 'agent',
      title: input.title || '',
      description: input.description ?? null,
      status: input.status || 'planned',
      completed: false,
      priority: input.priority ?? null,
      dueDate: null,
      parentId: input.parentId ?? null,
      dependsOn: [],
      order: 0,
      link: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      asanaGid: null,
      sessionName: null,
      executedBySession: null,
      blueprintId: null,
      type: null,
      targetProject: null,
      kind: null,
      acceptanceStatus: null,
      claimedBy: null,
      claimToken: null,
      claimedAt: null,
      claimLeaseMs: null,
      claim: null,
      approvedAt: null,
      approvedBy: null,
      heldAt: null,
      heldReason: null,
      retryCount: 0,
      completedBy: null,
      objectRef: null,
      servesCriterionId: null,
      servesCriterionIds: [],
      decisionRef: null,
      claimProbe: null,
      inheritedBlueprintFrom: null,
      inheritedFiles: [],
      declaredFiles: [],
      isBucket: false,
      frictionSignature: input.frictionSignature ?? null,
      filingProvenance: null,
      bugfixSpec: input.bugfixSpec ?? null,
    } as unknown as Todo;
  }

  it('files exactly one bugfix todo for the single newly-failing test, stamped with epicId and landSha', async () => {
    // In-memory store
    const rows: any[] = [];

    const deps: PostLandSweepDeps = {
      readBaselineNames: () => ['old failing test'],
      runSuiteFailingNames: async () => ['old failing test', 'brand new failing test'],
      ensureBucket: async () => 'bucket-1',
      findOpenTodoBySignature: (_p, sig) => rows.find((r) => r.frictionSignature === sig) ?? null,
      createTodo: async (_p, input) => {
        const row = createStubTodo(input);
        rows.push(row);
        return row;
      },
    };

    const result = await runPostLandTestSweep('test-project', {
      epicId: 'epic-abc123',
      landSha: 'abc1234567890def',
    }, deps);

    expect(result.filed).toEqual(['brand new failing test']);
    expect(result.skipped).toEqual([]);
    expect(rows.length).toBe(1);

    // Check that both epicId and landSha are in the serialized todo.
    const todo = rows[0];
    const serialized = JSON.stringify(todo);
    expect(serialized).toContain('epic-abc123');
    expect(serialized).toContain('abc1234567890def');
  });

  it('a second sweep over the same state files nothing and reports the name as skipped', async () => {
    // Re-use the same in-memory store from test 1 by creating it inline
    const rows: any[] = [];

    const deps: PostLandSweepDeps = {
      readBaselineNames: () => ['old failing test'],
      runSuiteFailingNames: async () => ['old failing test', 'brand new failing test'],
      ensureBucket: async () => 'bucket-1',
      findOpenTodoBySignature: (_p, sig) => rows.find((r) => r.frictionSignature === sig) ?? null,
      createTodo: async (_p, input) => {
        const row = createStubTodo(input);
        rows.push(row);
        return row;
      },
    };

    // First sweep creates a todo
    const first = await runPostLandTestSweep('test-project', {
      epicId: 'epic-abc123',
      landSha: 'abc1234567890def',
    }, deps);
    expect(first.filed.length).toBe(1);

    // Second sweep over the same state
    const second = await runPostLandTestSweep('test-project', {
      epicId: 'epic-xyz789',
      landSha: 'xyz7890abcdef123',
    }, deps);

    expect(second.filed).toEqual([]);
    expect(second.skipped).toEqual(['brand new failing test']);
    // createTodo still called only once total
    expect(rows.length).toBe(1);
  });

  it('resolves with an error string when runSuiteFailingNames throws', async () => {
    const deps: PostLandSweepDeps = {
      readBaselineNames: () => ['old failing test'],
      runSuiteFailingNames: async () => {
        throw new Error('suite crashed');
      },
      ensureBucket: async () => 'bucket-1',
      findOpenTodoBySignature: () => null,
      createTodo: async (_p, input) => createStubTodo(input),
    };

    const result = await runPostLandTestSweep('test-project', {
      epicId: 'epic-abc123',
      landSha: 'abc1234567890def',
    }, deps);

    // Should resolve (not reject) with an error string
    expect(typeof result.error).toBe('string');
    expect(result.filed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  describe('newlyFailingNames', () => {
    it('returns empty array when post matches baseline', () => {
      const result = newlyFailingNames(['test1', 'test2'], ['test1', 'test2']);
      expect(result).toEqual([]);
    });

    it('returns only new names not in baseline', () => {
      const result = newlyFailingNames(['test1'], ['test1', 'test2', 'test3']);
      expect(result).toEqual(['test2', 'test3']);
    });

    it('deduplicates within postLandNames', () => {
      const result = newlyFailingNames([], ['test1', 'test2', 'test1']);
      expect(result).toEqual(['test1', 'test2']);
    });

    it('preserves order from postLandNames', () => {
      const result = newlyFailingNames([], ['z', 'a', 'b', 'a']);
      expect(result).toEqual(['z', 'a', 'b']);
    });
  });

  describe('postLandSweepSignature', () => {
    it('returns stable signature format', () => {
      const sig = postLandSweepSignature('test name');
      expect(sig).toBe('post-land-sweep:test name');
    });
  });
});
