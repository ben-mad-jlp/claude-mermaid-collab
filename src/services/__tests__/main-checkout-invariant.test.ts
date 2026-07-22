import { describe, test, expect } from 'bun:test';
import {
  readMainCheckoutHead,
  withMainCheckoutInvariant,
  MainCheckoutBranchChangedError,
  type GitRunner,
  type MainCheckoutHead,
} from '../main-checkout-invariant';

/** Queue-based mock GitRunner for canned responses. */
function queuedGitRunner(responses: Array<{ code: number; stdout: string; stderr: string }>): GitRunner {
  let index = 0;
  return async (cwd: string, args: string[]) => {
    if (index >= responses.length) {
      throw new Error(`GitRunner exhausted: expected ${responses.length} calls, got more`);
    }
    return responses[index++];
  };
}

describe('readMainCheckoutHead', () => {
  test('returns branch name and sha when both git commands succeed', async () => {
    const runner = queuedGitRunner([
      { code: 0, stdout: 'master\n', stderr: '' },
      { code: 0, stdout: 'abc123def456\n', stderr: '' },
    ]);
    const result = await readMainCheckoutHead('/test/repo', runner);
    expect(result.branch).toBe('master');
    expect(result.sha).toBe('abc123def456');
  });

  test('returns null sha when rev-parse fails', async () => {
    const runner = queuedGitRunner([
      { code: 0, stdout: 'master\n', stderr: '' },
      { code: 1, stdout: '', stderr: 'fatal: Not a git repository' },
    ]);
    const result = await readMainCheckoutHead('/test/repo', runner);
    expect(result.branch).toBe('master');
    expect(result.sha).toBe('');
  });

  test('returns null branch when symbolic-ref fails (non-git fallback)', async () => {
    const runner = queuedGitRunner([
      { code: 1, stdout: '', stderr: 'fatal: Not a git repository' },
      { code: 1, stdout: '', stderr: 'fatal: Not a git repository' },
    ]);
    const result = await readMainCheckoutHead('/test/repo', runner);
    expect(result.branch).toBeNull();
    expect(result.sha).toBe('');
  });

  test('returns null branch when HEAD is detached', async () => {
    const runner = queuedGitRunner([
      { code: 1, stdout: '', stderr: 'fatal: ref HEAD is not a symbolic ref' },
      { code: 0, stdout: 'def456abc123\n', stderr: '' },
    ]);
    const result = await readMainCheckoutHead('/test/repo', runner);
    expect(result.branch).toBeNull();
    expect(result.sha).toBe('def456abc123');
  });

  test('trims whitespace from outputs', async () => {
    const runner = queuedGitRunner([
      { code: 0, stdout: '  feature-branch  \n', stderr: '' },
      { code: 0, stdout: '  deadbeef12345678  \n', stderr: '' },
    ]);
    const result = await readMainCheckoutHead('/test/repo', runner);
    expect(result.branch).toBe('feature-branch');
    expect(result.sha).toBe('deadbeef12345678');
  });
});

describe('withMainCheckoutInvariant', () => {
  test('throws MainCheckoutBranchChangedError when branch changes', async () => {
    const responses = [
      { code: 0, stdout: 'master\n', stderr: '' },     // before: symbolic-ref
      { code: 0, stdout: 'abc123\n', stderr: '' },     // before: rev-parse
      { code: 0, stdout: 'collab/epic/x\n', stderr: '' }, // after: symbolic-ref
      { code: 0, stdout: 'def456\n', stderr: '' },     // after: rev-parse
    ];
    const runner = queuedGitRunner(responses);

    let error: MainCheckoutBranchChangedError | undefined;
    try {
      await withMainCheckoutInvariant('/test/repo', runner, async () => 'result');
    } catch (err) {
      error = err as MainCheckoutBranchChangedError;
    }

    expect(error).toBeDefined();
    expect(error!.name).toBe('MainCheckoutBranchChangedError');
    expect(error!.projectRoot).toBe('/test/repo');
    expect(error!.before.branch).toBe('master');
    expect(error!.before.sha).toBe('abc123');
    expect(error!.after.branch).toBe('collab/epic/x');
    expect(error!.after.sha).toBe('def456');
  });

  test('allows operation when named branch stays the same, sha advances', async () => {
    const responses = [
      { code: 0, stdout: 'master\n', stderr: '' },  // before: symbolic-ref
      { code: 0, stdout: 'abc123\n', stderr: '' },  // before: rev-parse
      { code: 0, stdout: 'master\n', stderr: '' },  // after: symbolic-ref
      { code: 0, stdout: 'def456\n', stderr: '' },  // after: rev-parse (reset --hard during fn)
    ];
    const runner = queuedGitRunner(responses);

    const result = await withMainCheckoutInvariant('/test/repo', runner, async () => 'success');
    expect(result).toBe('success');
  });

  test('allows operation when detached HEAD stays on same sha', async () => {
    const responses = [
      { code: 1, stdout: '', stderr: 'detached' },      // before: symbolic-ref (detached)
      { code: 0, stdout: 'abc123\n', stderr: '' },      // before: rev-parse
      { code: 1, stdout: '', stderr: 'detached' },      // after: symbolic-ref (detached)
      { code: 0, stdout: 'abc123\n', stderr: '' },      // after: rev-parse (same sha)
    ];
    const runner = queuedGitRunner(responses);

    const result = await withMainCheckoutInvariant('/test/repo', runner, async () => 42);
    expect(result).toBe(42);
  });

  test('throws when detached HEAD changes sha', async () => {
    const responses = [
      { code: 1, stdout: '', stderr: 'detached' },      // before: symbolic-ref (detached)
      { code: 0, stdout: 'abc123\n', stderr: '' },      // before: rev-parse
      { code: 1, stdout: '', stderr: 'detached' },      // after: symbolic-ref (detached)
      { code: 0, stdout: 'def456\n', stderr: '' },      // after: rev-parse (different sha)
    ];
    const runner = queuedGitRunner(responses);

    let error: MainCheckoutBranchChangedError | undefined;
    try {
      await withMainCheckoutInvariant('/test/repo', runner, async () => 'result');
    } catch (err) {
      error = err as MainCheckoutBranchChangedError;
    }

    expect(error).toBeDefined();
    expect(error!.before.branch).toBeNull();
    expect(error!.after.branch).toBeNull();
    expect(error!.before.sha).toBe('abc123');
    expect(error!.after.sha).toBe('def456');
  });

  test('throws when switching from branch to detached', async () => {
    const responses = [
      { code: 0, stdout: 'master\n', stderr: '' },      // before: symbolic-ref (named branch)
      { code: 0, stdout: 'abc123\n', stderr: '' },      // before: rev-parse
      { code: 1, stdout: '', stderr: 'detached' },      // after: symbolic-ref (detached)
      { code: 0, stdout: 'abc123\n', stderr: '' },      // after: rev-parse (same sha)
    ];
    const runner = queuedGitRunner(responses);

    let error: MainCheckoutBranchChangedError | undefined;
    try {
      await withMainCheckoutInvariant('/test/repo', runner, async () => 'result');
    } catch (err) {
      error = err as MainCheckoutBranchChangedError;
    }

    expect(error).toBeDefined();
    expect(error!.before.branch).toBe('master');
    expect(error!.after.branch).toBeNull();
  });

  test('propagates fn() rejection without checking invariant', async () => {
    const responses = [
      { code: 0, stdout: 'master\n', stderr: '' },      // before: symbolic-ref
      { code: 0, stdout: 'abc123\n', stderr: '' },      // before: rev-parse
    ];
    const runner = queuedGitRunner(responses);

    const testError = new Error('test failure');
    await expect(
      withMainCheckoutInvariant('/test/repo', runner, async () => {
        throw testError;
      }),
    ).rejects.toBe(testError);
  });

  test('returns fn() result unchanged when invariant holds', async () => {
    const testValue = { data: 'test' };
    const responses = [
      { code: 0, stdout: 'master\n', stderr: '' },      // before: symbolic-ref
      { code: 0, stdout: 'abc123\n', stderr: '' },      // before: rev-parse
      { code: 0, stdout: 'master\n', stderr: '' },      // after: symbolic-ref
      { code: 0, stdout: 'abc123\n', stderr: '' },      // after: rev-parse (no change)
    ];
    const runner = queuedGitRunner(responses);

    const result = await withMainCheckoutInvariant('/test/repo', runner, async () => testValue);
    expect(result).toBe(testValue);
  });

  test('handles non-git fallback: both probes fail → no-op', async () => {
    const responses = [
      { code: 1, stdout: '', stderr: 'not a git repo' },  // before: symbolic-ref
      { code: 1, stdout: '', stderr: 'not a git repo' },  // before: rev-parse
      { code: 1, stdout: '', stderr: 'not a git repo' },  // after: symbolic-ref
      { code: 1, stdout: '', stderr: 'not a git repo' },  // after: rev-parse
    ];
    const runner = queuedGitRunner(responses);

    const result = await withMainCheckoutInvariant('/test/repo', runner, async () => 'ok');
    expect(result).toBe('ok');
  });
});
