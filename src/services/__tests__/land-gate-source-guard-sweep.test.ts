import { describe, it, expect } from 'bun:test';
import type { GateDeclaration, GateSpawn } from '../leaf-gate';
import type { EpicLandGateOpts, EpicLandGateResult } from '../epic-land-gate';
import { runEpicLandGate, SOURCE_GUARD_SWEEP_RE } from '../epic-land-gate';

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

const createMockGit = (overrides?: Record<string, { code: number; stdout: string }>) => {
  return (cwd: string, args: string[]) => {
    const key = args.join('|');
    if (overrides?.[key]) return overrides[key];

    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, stdout: 'abcdef12\n' };
    if (args[0] === 'rev-parse' && args[1] === 'master') return { code: 0, stdout: 'c88912ae\n' };
    if (args[0] === 'merge-base') return { code: 0, stdout: 'c88912ae\n' };
    if (args[0] === 'diff') return { code: 0, stdout: 'src/services/__tests__/test.test.ts\n' };
    if (args[0] === 'worktree' && args[1] === 'add') return { code: 0, stdout: '' };
    if (args[0] === 'worktree' && (args[1] === 'remove' || args[1] === 'prune')) return { code: 0, stdout: '' };
    return { code: 1, stdout: '' };
  };
};

describe('land-gate-source-guard-sweep', () => {
  describe('SOURCE_GUARD_SWEEP_RE export', () => {
    it('should match source-guard specs', () => {
      expect(SOURCE_GUARD_SWEEP_RE.test('src/services/__tests__/source-guard.test.ts')).toBe(true);
    });

    it('should match snapshot specs', () => {
      expect(SOURCE_GUARD_SWEEP_RE.test('src/services/__tests__/snapshot.test.ts')).toBe(true);
    });

    it('should match invariant specs', () => {
      expect(SOURCE_GUARD_SWEEP_RE.test('src/services/__tests__/invariant.test.ts')).toBe(true);
    });

    it('should match case-insensitive variants', () => {
      expect(SOURCE_GUARD_SWEEP_RE.test('src/services/__tests__/SOURCE-GUARD.test.ts')).toBe(true);
      expect(SOURCE_GUARD_SWEEP_RE.test('src/services/__tests__/Snapshot.test.ts')).toBe(true);
    });

    it('should not match regular specs', () => {
      expect(SOURCE_GUARD_SWEEP_RE.test('src/services/__tests__/normal.test.ts')).toBe(false);
    });
  });

  describe('red out-of-change-set source-guard blocks a clean-change-set epic', () => {
    it('should fail when an empty diff epic has a red out-of-change-set source-guard spec', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        // source-guard spec fails
        if (command.includes('source-guard.test.ts')) {
          return { ran: true, code: 1, output: 'FAIL: source-guard assertion failed' };
        }
        return { ran: true, code: 0, output: 'OK' };
      };

      const mockGit = createMockGit({
        'diff|--name-only|--diff-filter=d|c88912ae|HEAD': { code: 0, stdout: '' },
        'ls-files': {
          code: 0,
          stdout: 'src/services/__tests__/source-guard.test.ts\n',
        },
      });

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: mockGit,
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('fail');
      expect(result.sweep).toBeDefined();
      expect(result.sweep!.status).toBe('fail');
      expect(result.sweep!.specFiles.length).toBe(1);
      expect(result.reasons.some((r) => r.includes('SOURCE-GUARD SWEEP FAIL'))).toBe(true);
    });
  });

  describe('a green sweep still lands', () => {
    it('should pass when swept source-guard spec is green', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        // source-guard spec passes
        if (command.includes('source-guard.test.ts')) {
          return { ran: true, code: 0, output: 'PASS' };
        }
        return { ran: true, code: 0, output: 'OK' };
      };

      const mockGit = createMockGit({
        'diff|--name-only|--diff-filter=d|c88912ae|HEAD': { code: 0, stdout: '' },
        'ls-files': {
          code: 0,
          stdout: 'src/services/__tests__/source-guard.test.ts\n',
        },
      });

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: mockGit,
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('pass');
      expect(result.sweep).toBeDefined();
      expect(result.sweep!.status).toBe('pass');
      expect(result.reasons.some((r) => r.includes('source-guard sweep: green'))).toBe(true);
    });
  });

  describe('sweep runs alongside a passing change-set', () => {
    it('should fail when a passing change-set has a red source-guard spec', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        // Regular spec passes
        if (command.includes('test.test.ts') && !command.includes('source-guard')) {
          return { ran: true, code: 0, output: 'PASS' };
        }
        // source-guard spec fails
        if (command.includes('source-guard.test.ts')) {
          return { ran: true, code: 1, output: 'FAIL: source-guard check failed' };
        }
        return { ran: true, code: 0, output: 'OK' };
      };

      const mockGit = createMockGit({
        'diff|--name-only|--diff-filter=d|c88912ae|HEAD': {
          code: 0,
          stdout: 'src/services/__tests__/test.test.ts\n',
        },
        'ls-files': {
          code: 0,
          stdout:
            'src/services/__tests__/test.test.ts\nsrc/services/__tests__/source-guard.test.ts\n',
        },
      });

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: mockGit,
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('fail');
      expect(result.sweep).toBeDefined();
      expect(result.sweep!.status).toBe('fail');
      expect(result.reasons.some((r) => r.includes('SOURCE-GUARD SWEEP FAIL'))).toBe(true);
    });
  });

  describe('no source-guard specs → sweep is a no-op pass', () => {
    it('should pass when ls-files yields only non-guard specs', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        return { ran: true, code: 0, output: 'OK' };
      };

      const mockGit = createMockGit({
        'diff|--name-only|--diff-filter=d|c88912ae|HEAD': { code: 0, stdout: '' },
        'ls-files': {
          code: 0,
          stdout: 'src/services/__tests__/normal.test.ts\nsrc/other.test.ts\n',
        },
      });

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: mockGit,
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('pass');
      expect(result.sweep).toBeDefined();
      expect(result.sweep!.specFiles.length).toBe(0);
    });
  });

  describe('sweep excludes change-set specs', () => {
    it('should exclude change-set specs from sweep to avoid double-run', async () => {
      let sweepSpecsRun: string[] = [];

      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        // Track which specs are run in sweep (would be run with baseline)
        if (cwd.includes('collab-land-gate') || cwd.includes('tmp')) {
          // This is baseline pass — specs run here are sweep specs
          if (command.includes('source-guard')) {
            sweepSpecsRun.push(command);
          }
          return { ran: true, code: 0, output: 'OK' };
        }
        // Branch pass
        if (command.includes('test.test.ts')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        if (command.includes('source-guard')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        return { ran: true, code: 0, output: 'OK' };
      };

      const mockGit = createMockGit({
        'diff|--name-only|--diff-filter=d|c88912ae|HEAD': {
          code: 0,
          stdout: 'src/services/__tests__/test.test.ts\n',
        },
        'ls-files': {
          code: 0,
          stdout:
            'src/services/__tests__/test.test.ts\nsrc/services/__tests__/source-guard.test.ts\n',
        },
      });

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: mockGit,
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('pass');
      // sweep should include only the source-guard spec, not the test.test.ts (which was in change-set)
      expect(result.sweep!.specFiles.length).toBe(1);
      expect(result.sweep!.specFiles[0]).toInclude('source-guard');
    });
  });
});
