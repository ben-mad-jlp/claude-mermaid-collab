import { describe, expect, test, beforeEach } from 'bun:test';
import { isEpicLandedInGit, getEpicLandCommit, isEpicTreeIdenticalToTrunk, type GitRunner } from '../epic-landedness.js';
import { resetTrunkLandIndex } from '../trunk-land-index.js';

describe('isEpicLandedInGit', () => {
  beforeEach(() => {
    resetTrunkLandIndex();
  });

  test('returns landed when a Collab-Epic commit is reachable from the detected trunk even though landedAt/status are unset', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'sometip\n' };
      if (args[0] === 'log') return { code: 0, stdout: '\x1eabc123def456\t2026-07-01T10:00:00+00:00\tCollab-Epic: deadbeef\n' };
      return { code: 1, stdout: '' };
    };
    const result = await isEpicLandedInGit('/repo', 'deadbeef', { runGit });
    expect(result).toBe('landed');
  });

  test('returns not-landed for an epic with a landedAt stamp but no trunk-reachable commit', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'sometip\n' };
      if (args[0] === 'log') return { code: 0, stdout: '' };
      return { code: 1, stdout: '' };
    };
    const result = await isEpicLandedInGit('/repo', 'deadbeef', { runGit });
    expect(result).toBe('not-landed');
  });

  test('returns indeterminate and never throws when git fails', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'sometip\n' };
      if (args[0] === 'log') throw new Error('git exploded');
      return { code: 1, stdout: '' };
    };
    await expect(isEpicLandedInGit('/repo', 'deadbeef', { runGit })).resolves.toBe('indeterminate');
  });

  test('uses the detected trunk name in the git log argv, not a literal master', async () => {
    let capturedArgs: string[] | undefined;
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'main\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'sometip\n' };
      if (args[0] === 'log') {
        capturedArgs = args;
        return { code: 0, stdout: '\x1eabc123def456\t2026-07-01T10:00:00+00:00\tCollab-Epic: deadbeef\n' };
      }
      return { code: 1, stdout: '' };
    };
    await isEpicLandedInGit('/repo', 'deadbeef', { runGit });
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs).toContain('main');
    expect(capturedArgs).not.toContain('master');
  });
});

describe('getEpicLandCommit', () => {
  beforeEach(() => {
    resetTrunkLandIndex();
  });

  test('returns landed with sha and committedAtIso when a Collab-Epic commit is reachable from the detected trunk', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'sometip\n' };
      if (args[0] === 'log') return { code: 0, stdout: '\x1eabc123def456\t2026-07-01T10:00:00+00:00\tCollab-Epic: deadbeef\n' };
      return { code: 1, stdout: '' };
    };
    const result = await getEpicLandCommit('/repo', 'deadbeef', { runGit });
    expect(result.status).toBe('landed');
    expect(result.sha).toBe('abc123def456');
    expect(result.committedAtIso).toBe('2026-07-01T10:00:00+00:00');
  });

  test('returns not-landed with null sha when no trunk-reachable commit exists', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'sometip\n' };
      if (args[0] === 'log') return { code: 0, stdout: '' };
      return { code: 1, stdout: '' };
    };
    const result = await getEpicLandCommit('/repo', 'deadbeef', { runGit });
    expect(result.status).toBe('not-landed');
    expect(result.sha).toBeNull();
    expect(result.committedAtIso).toBeNull();
  });

  test('returns indeterminate with null sha when git exits non-zero', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'sometip\n' };
      if (args[0] === 'log') return { code: 1, stdout: '' };
      return { code: 1, stdout: '' };
    };
    const result = await getEpicLandCommit('/repo', 'deadbeef', { runGit });
    expect(result.status).toBe('indeterminate');
    expect(result.sha).toBeNull();
    expect(result.committedAtIso).toBeNull();
  });

  test('returns indeterminate and never throws when git fails', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'sometip\n' };
      if (args[0] === 'log') throw new Error('git exploded');
      return { code: 1, stdout: '' };
    };
    await expect(getEpicLandCommit('/repo', 'deadbeef', { runGit })).resolves.toEqual({
      status: 'indeterminate',
      sha: null,
      committedAtIso: null,
    });
  });
});

describe('isEpicTreeIdenticalToTrunk', () => {
  beforeEach(() => {
    resetTrunkLandIndex();
  });

  test('returns identical when the epic and trunk tree shas match even though the branch is ahead', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') {
        // Both branch and trunk have the same tree SHA
        return { code: 0, stdout: 'abc123deadbeef\n' };
      }
      return { code: 1, stdout: '' };
    };
    const result = await isEpicTreeIdenticalToTrunk('/repo', 'deadbeef', { runGit });
    expect(result).toBe('identical');
  });

  test('returns differs when the epic and trunk tree shas do not match', async () => {
    let callCount = 0;
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') {
        callCount++;
        // First call: branch tree SHA; second call: trunk tree SHA
        return callCount === 1
          ? { code: 0, stdout: 'abc123\n' }
          : { code: 0, stdout: 'def456\n' };
      }
      return { code: 1, stdout: '' };
    };
    const result = await isEpicTreeIdenticalToTrunk('/repo', 'deadbeef', { runGit });
    expect(result).toBe('differs');
  });

  test('returns indeterminate and never throws when a rev-parse fails', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 1, stdout: '' };
      return { code: 1, stdout: '' };
    };
    const result = await isEpicTreeIdenticalToTrunk('/repo', 'deadbeef', { runGit });
    expect(result).toBe('indeterminate');
  });

  test('uses the detected trunk name in the rev-parse argv, not a literal master', async () => {
    const capturedArgs: string[][] = [];
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'main\n' };
      if (args[0] === 'rev-parse') {
        capturedArgs.push(args);
        return { code: 0, stdout: 'abc123\n' };
      }
      return { code: 1, stdout: '' };
    };
    await isEpicTreeIdenticalToTrunk('/repo', 'deadbeef', { runGit });
    expect(capturedArgs.length).toBeGreaterThanOrEqual(2);
    // Check that the trunk argument contains 'main', not 'master'
    const trunkRevParseCall = capturedArgs.find((args) => args[1] && args[1].includes('main'));
    expect(trunkRevParseCall).toBeDefined();
    expect(capturedArgs.some((args) => args[1] && args[1].includes('master'))).toBe(false);
  });
});
