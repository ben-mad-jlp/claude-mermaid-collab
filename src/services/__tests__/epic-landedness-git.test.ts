import { describe, expect, test } from 'bun:test';
import { isEpicLandedInGit, type GitRunner } from '../epic-landedness.js';

describe('isEpicLandedInGit', () => {
  test('returns landed when a Collab-Epic commit is reachable from the detected trunk even though landedAt/status are unset', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'log') return { code: 0, stdout: 'abc123\n' };
      return { code: 1, stdout: '' };
    };
    const result = await isEpicLandedInGit('/repo', 'deadbeef', { runGit });
    expect(result).toBe('landed');
  });

  test('returns not-landed for an epic with a landedAt stamp but no trunk-reachable commit', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'log') return { code: 0, stdout: '' };
      return { code: 1, stdout: '' };
    };
    const result = await isEpicLandedInGit('/repo', 'deadbeef', { runGit });
    expect(result).toBe('not-landed');
  });

  test('returns indeterminate and never throws when git fails', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'log') throw new Error('git exploded');
      return { code: 1, stdout: '' };
    };
    await expect(isEpicLandedInGit('/repo', 'deadbeef', { runGit })).resolves.toBe('indeterminate');
  });

  test('uses the detected trunk name in the git log argv, not a literal master', async () => {
    let capturedArgs: string[] | undefined;
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'main\n' };
      if (args[0] === 'log') {
        capturedArgs = args;
        return { code: 0, stdout: 'abc123\n' };
      }
      return { code: 1, stdout: '' };
    };
    await isEpicLandedInGit('/repo', 'deadbeef', { runGit });
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs).toContain('main');
    expect(capturedArgs).not.toContain('master');
  });
});
