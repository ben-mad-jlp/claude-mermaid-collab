import { describe, it, expect } from 'bun:test';
import type { GateDeclaration, GateSpawn } from '../leaf-gate';
import { runEpicLandGate } from '../epic-land-gate';

const decl: GateDeclaration = {
  kind: 'declared',
  cfg: {
    typecheck: 'npx tsc --noEmit',
    tests: [
      { match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' },
      { match: new RegExp('^ui/'), command: 'bun test {file}', mode: 'per-file' },
    ],
    typechecks: [
      { match: new RegExp('^ui/'), command: 'bunx tsc -p ui', cwd: 'ui' },
    ],
  },
  manifestPath: '.collab/project.json',
};

function makeMockGit(changedFiles: string[]) {
  return (cwd: string, args: string[]) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, stdout: 'abcdef12\n' };
    if (args[0] === 'rev-parse' && args[1] === 'master') return { code: 0, stdout: 'c88912ae\n' };
    if (args[0] === 'merge-base') return { code: 0, stdout: 'c88912ae\n' };
    if (args[0] === 'diff') return { code: 0, stdout: changedFiles.join('\n') };
    if (args[0] === 'worktree') return { code: 0, stdout: '' };
    return { code: 1, stdout: '' };
  };
}

function recordingSpawn(spawnCalls: string[], failingCommand?: string): GateSpawn {
  return async (_cwd, command) => {
    spawnCalls.push(command);
    if (failingCommand && command === failingCommand) {
      return { ran: true, code: 1, output: 'tsc error' };
    }
    return { ran: true, code: 0, output: 'OK' };
  };
}

const baseOpts = {
  project: 'test',
  repo: '/repo',
  epicId: 'typecheck1',
  epicBranch: 'collab/epic/typecheck1',
  epicWorktreeCwd: '/epic',
  decl,
  fs: { exists: () => true, symlink: () => {} },
  skipCache: true,
  quarantineLookup: () => [],
};

describe('land-gate touched-surface typecheck', () => {
  it('spawns the ^ui/ typechecks lane when the change-set is ui-only', async () => {
    const spawnCalls: string[] = [];
    const git = makeMockGit(['ui/src/a.test.ts']);
    const spawn = recordingSpawn(spawnCalls);

    const result = await runEpicLandGate({ ...baseOpts, git, spawn });

    expect(spawnCalls).toContain('bunx tsc -p ui');
    expect(result.status).toBe('pass');
    expect(result.typecheck?.command).toContain('bunx tsc -p ui');
  });

  it('does not spawn the ^ui/ typechecks lane when the change-set is src-only', async () => {
    const spawnCalls: string[] = [];
    const git = makeMockGit(['src/services/a.test.ts']);
    const spawn = recordingSpawn(spawnCalls);

    const result = await runEpicLandGate({ ...baseOpts, git, spawn });

    expect(spawnCalls).not.toContain('bunx tsc -p ui');
    expect(result.status).toBe('pass');
    expect(result.typecheck?.command).toBe('npx tsc --noEmit');
  });

  it('returns status fail when a matched typechecks lane fails', async () => {
    const spawnCalls: string[] = [];
    const git = makeMockGit(['ui/src/a.test.ts']);
    const spawn = recordingSpawn(spawnCalls, 'bunx tsc -p ui');

    const result = await runEpicLandGate({ ...baseOpts, git, spawn });

    expect(result.status).toBe('fail');
    expect(result.typecheck?.status).toBe('fail');
    expect(result.reasons.some((r) => r.includes('land gate: typecheck failed on'))).toBe(true);
  });
});
