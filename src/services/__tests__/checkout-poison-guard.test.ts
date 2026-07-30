import { describe, test, expect } from 'bun:test';
import {
  parsePoisonedStatus,
  detectPoisonedCheckout,
  restorePathsToHead,
  type GitRunner,
} from '../checkout-poison-guard';

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

/** Recording GitRunner that captures every (cwd, args) call. */
function recordingGitRunner(
  responses: Array<{ code: number; stdout: string; stderr: string }>,
): { runGit: GitRunner; calls: Array<{ cwd: string; args: string[] }> } {
  const calls: Array<{ cwd: string; args: string[] }> = [];
  let index = 0;
  const runGit: GitRunner = async (cwd: string, args: string[]) => {
    calls.push({ cwd, args });
    if (index >= responses.length) {
      throw new Error(`GitRunner exhausted: expected ${responses.length} calls, got more`);
    }
    return responses[index++];
  };
  return { runGit, calls };
}

describe('parsePoisonedStatus', () => {
  test('detects staged modification form "M "', () => {
    const { paths } = parsePoisonedStatus('M  src/a.ts');
    expect(paths).toContain('src/a.ts');
  });

  test('detects both staged and unstaged deletion forms', () => {
    const staged = parsePoisonedStatus('D  src/a.ts');
    const unstaged = parsePoisonedStatus(' D src/a.ts');
    expect(staged.paths).toContain('src/a.ts');
    expect(unstaged.paths).toContain('src/a.ts');
  });

  test('returns empty result for empty and whitespace-only input', () => {
    expect(parsePoisonedStatus('')).toEqual({ paths: [], kinds: [] });
    expect(parsePoisonedStatus('   \n  \n')).toEqual({ paths: [], kinds: [] });
  });

  test('extracts new path from rename form, excludes old path', () => {
    const { paths } = parsePoisonedStatus('R  old.ts -> new.ts');
    expect(paths).toContain('new.ts');
    expect(paths).not.toContain('old.ts');
  });
});

describe('detectPoisonedCheckout', () => {
  test('fails open on non-zero git exit', async () => {
    const runner = queuedGitRunner([{ code: 1, stdout: '', stderr: 'x' }]);
    const result = await detectPoisonedCheckout('/test/repo', runner);
    expect(result).toEqual({ poisoned: false, paths: [], detail: ['probe-failed'] });
  });
});

describe('restorePathsToHead', () => {
  test('issues scoped reset then checkout, never --hard or clean', async () => {
    const { runGit, calls } = recordingGitRunner([
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ]);

    await restorePathsToHead('/test/repo', ['src/a.ts', 'src/b.ts'], runGit);

    expect(calls.length).toBe(2);
    expect(calls[0].args).toEqual(['reset', '-q', 'HEAD', '--', 'src/a.ts', 'src/b.ts']);
    expect(calls[1].args).toEqual(['checkout', '-f', 'HEAD', '--', 'src/a.ts', 'src/b.ts']);

    for (const call of calls) {
      expect(call.args).not.toContain('--hard');
      expect(call.args).not.toContain('clean');
    }
  });
});
