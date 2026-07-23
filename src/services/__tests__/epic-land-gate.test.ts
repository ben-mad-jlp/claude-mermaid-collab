import { describe, it, expect, beforeEach } from 'bun:test';
import type { GateDeclaration, GateSpawn } from '../leaf-gate';
import type { EpicLandGateOpts, EpicLandGateResult } from '../epic-land-gate';
import { runEpicLandGate, landGateTrailer, landGateSummary } from '../epic-land-gate';

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

const mockAbsentGate: GateDeclaration = {
  kind: 'absent',
  manifestPath: '.collab/project.json',
  reason: 'manifest declares no gate block',
};

const mockMisconfiguredGate: GateDeclaration = {
  kind: 'misconfigured',
  manifestPath: '.collab/project.json',
  reason: 'gate.tests is not an array',
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

describe('epic-land-gate', () => {
  describe('exports', () => {
    it('should export runEpicLandGate function', () => {
      expect(typeof runEpicLandGate).toBe('function');
    });

    it('should export landGateTrailer function', () => {
      expect(typeof landGateTrailer).toBe('function');
    });

    it('should export landGateSummary function', () => {
      expect(typeof landGateSummary).toBe('function');
    });
  });

  describe('regression blocks', () => {
    it('should classify as regression when branch fails and master passes', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        // tsc always passes
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        // test: fail on branch, pass on baseline
        if (cwd.includes('collab-land-gate') || cwd.includes('tmp')) {
          return { ran: true, code: 0, output: 'PASS' };
        } else {
          return { ran: true, code: 1, output: 'FAIL: test suite failed' };
        }
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('fail');
      expect(result.regressions.length).toBeGreaterThan(0);
      expect(result.regressions[0].classification).toBe('regression');
    });

    it('regression blocks land (blocks does not equal zero)', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: '' };
        }
        return { ran: true, code: cwd.includes('collab-land-gate') || cwd.includes('tmp') ? 0 : 1, output: '' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('fail');
      expect(result.regressions.length).toBeGreaterThan(0);
    });
  });

  describe('inherited does not block', () => {
    it('should pass when both branch and master fail', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        // Both fail: inherited
        return { ran: true, code: 1, output: 'FAIL' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      // Status should be 'pass' with inherited failures noted
      expect(result.status).toBe('pass');
      expect(result.inherited.length).toBeGreaterThan(0);
      expect(result.regressions.length).toBe(0);
    });
  });

  describe('new specs must be green', () => {
    it('should treat absent file on master as regression', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        // Branch test fails, baseline test passes
        return { ran: true, code: cwd.includes('collab-land-gate') || cwd.includes('tmp') ? 0 : 1, output: 'FAIL' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: {
          exists: (p: string) => {
            // File exists on branch but not on baseline (temp worktree)
            if (p.includes('collab-land-gate') || p.includes('tmp')) return false;
            return true;
          },
          symlink: () => {},
        },
        skipCache: true,
      });

      expect(result.status).toBe('fail');
      expect(result.regressions.some(r => r.baseline === 'absent')).toBe(true);
    });
  });

  describe('cannot-run is an incident', () => {
    it('should mark as incident when spawn.ran is false on branch', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        return { ran: false, output: 'Command not found' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('error');
      expect(result.incidents.length).toBeGreaterThan(0);
      expect(result.incidents[0].branch).toBe('error');
    });

    it('should mark as incident when spawn.ran is false on baseline', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        if (cwd.includes('collab-land-gate') || cwd.includes('tmp')) {
          return { ran: false, output: 'Baseline command failed' };
        }
        return { ran: true, code: 1, output: 'Branch failed' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('error');
      expect(result.incidents.length).toBeGreaterThan(0);
    });

    it('never green when spawn cannot run', async () => {
      const mockSpawn: GateSpawn = async () => {
        return { ran: false, output: 'error' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).not.toBe('pass');
      expect(result.status).toBe('error');
    });
  });

  describe('missing baseline node_modules is an incident', () => {
    it('should mark as incident when baseline has no node_modules', async () => {
      let isBaseline = false;
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'OK' };
        }
        isBaseline = cwd.includes('collab-land-gate') || cwd.includes('tmp');
        return { ran: true, code: cwd.includes('collab-land-gate') || cwd.includes('tmp') ? 0 : 1, output: '' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: {
          exists: (p: string) => {
            // Source node_modules (master/repo) does not exist
            if (p.endsWith('node_modules') && p.includes('/repo')) return false;
            return true;
          },
          symlink: () => {},
        },
        skipCache: true,
      });

      // Should be error due to missing node_modules
      expect(result.status).toBe('error');
      expect(result.incidents.length).toBeGreaterThan(0);
    });
  });

  describe('misconfigured and absent gates', () => {
    it('should return error for misconfigured gate', async () => {
      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockMisconfiguredGate,
        spawn: async () => ({ ran: true, code: 0, output: '' }),
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('error');
      expect(result.declared).toBe(false);
      expect(result.reasons.some(r => r.includes('misconfigured'))).toBe(true);
    });

    it('should abstain for absent gate', async () => {
      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockAbsentGate,
        spawn: async () => ({ ran: true, code: 0, output: '' }),
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('abstain');
      expect(result.declared).toBe(false);
    });
  });

  describe('typecheck failures short-circuit', () => {
    it('should fail immediately on typecheck error and not run tests', async () => {
      let testSpawned = false;
      const mockSpawn: GateSpawn = async (cwd, command) => {
        if (command.includes('bun test')) {
          testSpawned = true;
        }
        return { ran: true, code: 0, output: 'ok' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: async (cwd, command) => {
          if (command.includes('tsc')) {
            return { ran: true, code: 1, output: 'Compilation error' };
          }
          return mockSpawn(cwd, command);
        },
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('fail');
      expect(testSpawned).toBe(false);
      expect(result.typecheck?.status).toBe('fail');
    });
  });

  describe('pass predicate requirements', () => {
    it('tsc-clean-but-tests-red can never be pass', async () => {
      const mockSpawn: GateSpawn = async (cwd, command) => {
        // Typecheck passes
        if (command.includes('tsc')) {
          return { ran: true, code: 0, output: 'ok' };
        }
        // Tests fail on branch, pass on baseline (temp worktree)
        if (cwd.includes('collab-land-gate') || cwd.includes('tmp')) {
          return { ran: true, code: 0, output: 'test passed' };
        }
        return { ran: true, code: 1, output: 'test failed' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).not.toBe('pass');
    });

    it('should pass only when typecheck and tests are green', async () => {
      const mockSpawn: GateSpawn = async () => {
        return { ran: true, code: 0, output: 'all pass' };
      };

      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('pass');
    });
  });

  describe('changeset handling', () => {
    it('should only gate SPEC_FILE_RE files', async () => {
      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: async () => ({ ran: true, code: 0, output: '' }),
        git: (cwd, args) => {
          if (args[0] === 'diff') {
            // Return mix of spec files and non-spec files
            return { code: 0, stdout: 'src/services/test.test.ts\nsrc/services/utils.ts\n' };
          }
          return createMockGit()(cwd, args);
        },
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      // Should only have test files in the result
      expect(result.specFiles.every(f => f.includes('.test.'))).toBe(true);
    });

    it('should exclude deleted files from changeset', async () => {
      const result = await runEpicLandGate({
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: async () => ({ ran: true, code: 0, output: '' }),
        git: (cwd, args) => {
          // The --diff-filter=d flag in the implementation should handle this
          if (args[0] === 'diff') {
            return { code: 0, stdout: 'src/services/test.test.ts\n' };
          }
          return createMockGit()(cwd, args);
        },
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('pass');
    });
  });

  describe('trailer generation', () => {
    it('should generate Land-Gate trailer for pass', () => {
      const result: EpicLandGateResult = {
        status: 'pass',
        declared: true,
        manifestPath: '.collab/project.json',
        typecheck: { command: 'tsc', status: 'pass', output: '' },
        units: [],
        regressions: [],
        inherited: [],
        incidents: [],
        reasons: [],
        specFiles: ['src/test.ts'],
        epicTipSha: 'abc123',
        baseSha: 'def456',
      };

      const trailer = landGateTrailer(result);
      expect(trailer).toContain('Land-Gate: pass');
      expect(trailer).toContain('Land-Gate-Specs: 1');
    });

    it('should not generate trailer for fail', () => {
      const result: EpicLandGateResult = {
        status: 'fail',
        declared: true,
        manifestPath: '.collab/project.json',
        units: [],
        regressions: [{ key: 'test', command: 'test', laneCwd: '', files: ['x'], branch: 'fail', classification: 'regression' }],
        inherited: [],
        incidents: [],
        reasons: [],
        specFiles: [],
        epicTipSha: null,
        baseSha: null,
      };

      const trailer = landGateTrailer(result);
      expect(trailer).toBe('');
    });

    it('should not generate trailer for error', () => {
      const result: EpicLandGateResult = {
        status: 'error',
        declared: true,
        manifestPath: '.collab/project.json',
        units: [],
        regressions: [],
        inherited: [],
        incidents: [],
        reasons: ['something failed'],
        specFiles: [],
        epicTipSha: null,
        baseSha: null,
      };

      const trailer = landGateTrailer(result);
      expect(trailer).toBe('');
    });

    it('should generate trailer with inherited failures noted', () => {
      const result: EpicLandGateResult = {
        status: 'pass',
        declared: true,
        manifestPath: '.collab/project.json',
        typecheck: { command: 'tsc', status: 'pass', output: '' },
        units: [],
        regressions: [],
        inherited: [{ key: 'test', command: 'test', laneCwd: '', files: ['x.test.ts'], branch: 'fail', baseline: 'fail', classification: 'inherited' }],
        incidents: [],
        reasons: [],
        specFiles: ['src/test.ts'],
        epicTipSha: 'abc123',
        baseSha: 'def456',
      };

      const trailer = landGateTrailer(result);
      expect(trailer).toContain('Land-Gate: pass');
      expect(trailer).toContain('Land-Gate-Inherited:');
    });
  });

  describe('cache behavior', () => {
    it('should skip cache when skipCache is true', async () => {
      let spawnCount = 0;
      const mockSpawn: GateSpawn = async () => {
        spawnCount++;
        return { ran: true, code: 0, output: '' };
      };

      const opts: EpicLandGateOpts = {
        project: 'test',
        repo: '/repo',
        epicId: 'test123',
        epicBranch: 'collab/epic/test123',
        epicWorktreeCwd: '/epic',
        decl: mockDeclaration,
        spawn: mockSpawn,
        git: createMockGit(),
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      };

      await runEpicLandGate(opts);
      expect(spawnCount).toBeGreaterThan(0);
    });
  });

  describe('summary generation', () => {
    it('should provide summary for pass', () => {
      const result: EpicLandGateResult = {
        status: 'pass',
        declared: true,
        manifestPath: '.collab/project.json',
        units: [],
        regressions: [],
        inherited: [],
        incidents: [],
        reasons: [],
        specFiles: ['src/test.ts', 'ui/test.tsx'],
        epicTipSha: 'abc123',
        baseSha: 'def456',
      };

      const summary = landGateSummary(result);
      expect(summary).toContain('green');
      expect(summary).toContain('2');
    });

    it('should provide summary for fail', () => {
      const result: EpicLandGateResult = {
        status: 'fail',
        declared: true,
        manifestPath: '.collab/project.json',
        units: [],
        regressions: [{ key: 'test', command: 'test', laneCwd: '', files: ['x'], branch: 'fail', classification: 'regression' }],
        inherited: [],
        incidents: [],
        reasons: [],
        specFiles: [],
        epicTipSha: null,
        baseSha: null,
      };

      const summary = landGateSummary(result);
      expect(summary).toContain('FAILED');
      expect(summary).toContain('1');
    });

    it('should provide summary for abstain', () => {
      const result: EpicLandGateResult = {
        status: 'abstain',
        declared: false,
        manifestPath: '.collab/project.json',
        units: [],
        regressions: [],
        inherited: [],
        incidents: [],
        reasons: [],
        specFiles: [],
        epicTipSha: null,
        baseSha: null,
      };

      const summary = landGateSummary(result);
      expect(summary).toContain('ABSTAINED');
    });
  });

  describe('regression floor', () => {
    it('floor red → land fails', async () => {
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
        // floor command fails
        if (command.includes('test:floor')) {
          return {
            ran: true,
            code: 1,
            output: '1 new file(s) FAILED:\n\n──────── src/services/foo.test.ts ────────\nsome trace\n',
          };
        }
        // tests pass
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
      expect(result.floor?.failing).toContain('src/services/foo.test.ts');
      expect(result.reasons[0]).toContain('REGRESSION FLOOR FAILED');
    });

    it('floor green → land proceeds', async () => {
      const mockDeclarationWithFloor: GateDeclaration = {
        kind: 'declared',
        cfg: {
          ...mockDeclaration.cfg,
          floors: [{ match: new RegExp('^src/'), command: 'bun run test:floor' }],
        },
        manifestPath: '.collab/project.json',
      };

      const mockSpawn: GateSpawn = async (cwd, command) => {
        // everything passes
        if (command.includes('tsc') || command.includes('test:floor')) {
          return { ran: true, code: 0, output: 'OK' };
        }
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
          if (args[0] === 'diff') {
            return { code: 0, stdout: 'src/services/test.test.ts\n' };
          }
          return createMockGit()(cwd, args);
        },
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('pass');
      expect(result.floor?.status).toBe('pass');
    });

    it('floor red with an empty spec diff → still fails', async () => {
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
        // floor command fails
        if (command.includes('test:floor')) {
          return {
            ran: true,
            code: 1,
            output: '1 file(s) FAILED:\n\n──────── src/services/foo.test.ts ────────\nsome trace\n',
          };
        }
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
          if (args[0] === 'diff') {
            // Return a non-spec file (source change, not test file)
            return { code: 0, stdout: 'src/services/foo.ts\n' };
          }
          return createMockGit()(cwd, args);
        },
        fs: { exists: () => true, symlink: () => {} },
        skipCache: true,
      });

      expect(result.status).toBe('fail');
      expect(result.floor?.status).toBe('fail');
      expect(result.units).toHaveLength(0);
    });
  });
});
