import { describe, it, expect } from 'bun:test';
import type { GateDeclaration, GateSpawn } from '../leaf-gate';
import { runEpicLandGate } from '../epic-land-gate';

const mockDeclaration: GateDeclaration = {
  kind: 'declared',
  cfg: {
    typecheck: 'npx tsc --noEmit',
    tests: [
      { match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' },
      { match: new RegExp('^ui/'), command: 'bunx vitest --run {files}', cwd: 'ui', mode: 'batch' },
    ],
  },
  manifestPath: '.collab/project.json',
};

const createMockGit = () => {
  return (cwd: string, args: string[]) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, stdout: 'abcdef12\n' };
    if (args[0] === 'rev-parse' && args[1] === 'master') return { code: 0, stdout: 'c88912ae\n' };
    if (args[0] === 'merge-base') return { code: 0, stdout: 'c88912ae\n' };
    if (args[0] === 'diff') return { code: 0, stdout: '' };
    if (args[0] === 'worktree' && args[1] === 'add') return { code: 0, stdout: '' };
    if (args[0] === 'worktree' && (args[1] === 'remove' || args[1] === 'prune')) return { code: 0, stdout: '' };
    return { code: 1, stdout: '' };
  };
};

describe('land-gate-floor-always', () => {
  it('production-only diff → floor runs and passes', async () => {
    const mockDeclarationWithFloor: GateDeclaration = {
      kind: 'declared',
      cfg: {
        ...mockDeclaration.cfg,
        floors: [{ match: new RegExp('^src/'), command: 'bun run test:floor' }],
      },
      manifestPath: '.collab/project.json',
    };

    const spawnCalls: string[] = [];
    const mockSpawn: GateSpawn = async (cwd, command) => {
      spawnCalls.push(command);

      // typecheck passes
      if (command.includes('tsc')) {
        return { ran: true, code: 0, output: 'OK' };
      }
      // floor command passes
      if (command.includes('test:floor')) {
        return { ran: true, code: 0, output: 'OK' };
      }
      // other tests pass
      return { ran: true, code: 0, output: 'PASS' };
    };

    const result = await runEpicLandGate({
      project: 'test',
      repo: '/repo',
      epicId: 'test123',
      epicBranch: 'collab/epic/test123',
      epicWorktreeCwd: '/epic',
      decl: mockDeclarationWithFloor,
      spawn: mockSpawn,
      git: (cwd, args) => {
        // Return a production file (not a test file)
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'src/services/foo.ts\n' };
        }
        return createMockGit()(cwd, args);
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    // Verify floor command was invoked
    expect(spawnCalls).toContain('bun run test:floor');
    expect(result.floor?.status).toBe('pass');
    expect(result.status).toBe('pass');
  });

  it('diff matches no floor lane → floor still invoked, result.floor defined', async () => {
    const mockDeclarationWithFloor: GateDeclaration = {
      kind: 'declared',
      cfg: {
        ...mockDeclaration.cfg,
        floors: [{ match: new RegExp('^src/'), command: 'bun run test:floor' }],
      },
      manifestPath: '.collab/project.json',
    };

    const spawnCalls: string[] = [];
    const mockSpawn: GateSpawn = async (cwd, command) => {
      spawnCalls.push(command);

      // typecheck passes
      if (command.includes('tsc')) {
        return { ran: true, code: 0, output: 'OK' };
      }
      // floor command passes
      if (command.includes('test:floor')) {
        return { ran: true, code: 0, output: 'OK' };
      }
      // other tests pass
      return { ran: true, code: 0, output: 'PASS' };
    };

    const result = await runEpicLandGate({
      project: 'test',
      repo: '/repo',
      epicId: 'test123',
      epicBranch: 'collab/epic/test123',
      epicWorktreeCwd: '/epic',
      decl: mockDeclarationWithFloor,
      spawn: mockSpawn,
      git: (cwd, args) => {
        // Return a docs file (does not match floor's ^src/ pattern)
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'docs/README.md\n' };
        }
        return createMockGit()(cwd, args);
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    // Verify floor command was invoked even though the diff doesn't match ^src/
    expect(spawnCalls).toContain('bun run test:floor');
    expect(result.floor).toBeDefined();
    expect(result.floor?.status).toBe('pass');
    expect(result.status).toBe('pass');
  });

  it('floor fails on a production-only diff → status fail with failing test named', async () => {
    const mockDeclarationWithFloor: GateDeclaration = {
      kind: 'declared',
      cfg: {
        ...mockDeclaration.cfg,
        floors: [{ match: new RegExp('^src/'), command: 'bun run test:floor' }],
      },
      manifestPath: '.collab/project.json',
    };

    const mockSpawn: GateSpawn = async (cwd, command) => {
      // typecheck passes
      if (command.includes('tsc')) {
        return { ran: true, code: 0, output: 'OK' };
      }
      // floor command fails with failing test marker
      if (command.includes('test:floor')) {
        return {
          ran: true,
          code: 1,
          output: '1 file(s) FAILED:\n\n──────── src/services/regression.test.ts ────────\nsome trace\n',
        };
      }
      // other tests pass
      return { ran: true, code: 0, output: 'PASS' };
    };

    const result = await runEpicLandGate({
      project: 'test',
      repo: '/repo',
      epicId: 'test123',
      epicBranch: 'collab/epic/test123',
      epicWorktreeCwd: '/epic',
      decl: mockDeclarationWithFloor,
      spawn: mockSpawn,
      git: (cwd, args) => {
        // Return a production file
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'src/services/foo.ts\n' };
        }
        return createMockGit()(cwd, args);
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    expect(result.status).toBe('fail');
    expect(result.floor?.status).toBe('fail');
    expect(result.floor?.failing).toContain('src/services/regression.test.ts');
    expect(result.reasons[0]).toContain('REGRESSION FLOOR FAILED');
  });
});
