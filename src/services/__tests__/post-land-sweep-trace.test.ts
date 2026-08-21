import { describe, it, expect } from 'bun:test';
import { runPostLandTestSweep, type PostLandSweepDeps } from '../post-land-test-sweep.js';
import type { Todo } from '../todo-store.js';

describe('post-land-sweep-trace', () => {
  it('files a trace with one id and name per created todo', async () => {
    let counter = 0;
    const deps: PostLandSweepDeps = {
      readBaselineNames: () => [],
      runSuiteFailingNames: async () => ['alpha handles retry', 'beta handles retry'],
      ensureBucket: async () => 'bucket-1',
      findOpenTodoBySignature: () => null,
      createTodo: async (_p, input) => {
        counter += 1;
        return { id: `todo-${counter}`, ...input } as unknown as Todo;
      },
    };

    const result = await runPostLandTestSweep('test-project', {
      epicId: 'epic-abc123',
      landSha: 'abc1234567890def',
    }, deps);

    expect(result.trace.filedIds.length).toBe(2);
    expect(result.trace.testNames).toContain('alpha handles retry');
    expect(result.trace.testNames).toContain('beta handles retry');
  });

  it('reports nothing-to-file when no tests are newly failing', async () => {
    const deps: PostLandSweepDeps = {
      readBaselineNames: () => [],
      runSuiteFailingNames: async () => [],
      ensureBucket: async () => 'bucket-1',
      findOpenTodoBySignature: () => null,
      createTodo: async (_p, input) => ({ id: 'todo-1', ...input } as unknown as Todo),
    };

    const result = await runPostLandTestSweep('test-project', {
      epicId: 'epic-abc123',
      landSha: 'abc1234567890def',
    }, deps);

    expect(result.trace.reason).toBe('nothing-to-file');
  });

  it('carries the thrown message in the trace reason and still resolves', async () => {
    const deps: PostLandSweepDeps = {
      readBaselineNames: () => [],
      runSuiteFailingNames: async () => {
        throw new Error('suite crashed for real');
      },
      ensureBucket: async () => 'bucket-1',
      findOpenTodoBySignature: () => null,
      createTodo: async (_p, input) => ({ id: 'todo-1', ...input } as unknown as Todo),
    };

    const result = await runPostLandTestSweep('test-project', {
      epicId: 'epic-abc123',
      landSha: 'abc1234567890def',
    }, deps);

    expect(result.trace.reason).toContain('suite crashed for real');
  });
});
