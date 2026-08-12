import { describe, it, expect } from 'bun:test';
import type { GateDeclaration, GateSpawn } from '../leaf-gate';
import type { TestQuarantineRow } from '../worker-ledger';
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

describe('land-gate-floor-quarantine', () => {
  it('downgrades to pass when floor failing path resolves to fully-quarantined test names', async () => {
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
      // floor command fails with a failing test that will be quarantined
      if (command.includes('test:floor')) {
        return {
          ran: true,
          code: 1,
          output: `1 file(s) FAILED:

──────── src/services/regression.test.ts ────────
 × my flaky test 523ms
some trace details
`,
        };
      }
      // other tests pass
      return { ran: true, code: 0, output: 'PASS' };
    };

    const mockQuarantineData: TestQuarantineRow[] = [
      {
        project: 'test',
        test: 'my flaky test',
        quarantinedAtSha: 'abc123def456',
        evidence: { runs: 5, passRuns: 3, failRuns: 2 },
        ttlExpiresAt: Date.now() + 86400000,
        seededFrom: null,
        createdAt: Date.now(),
      },
    ];

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
      quarantineLookup: () => mockQuarantineData,
    });

    // Verify floor command was invoked
    expect(spawnCalls).toContain('bun run test:floor');
    expect(result.floor?.status).toBe('fail');
    expect(result.floor?.failing).toContain('src/services/regression.test.ts');
    // Verify downgrade happened
    expect(result.status).toBe('pass');
    expect(result.quarantinedOnlyFailures).toEqual(['src/services/regression.test.ts']);
    expect(result.reasons.some((r) => r.includes('quarantined-only floor failure'))).toBe(true);
  });

  it('stays fail when one failing entry is not quarantined', async () => {
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
      // floor command fails with two test sections
      if (command.includes('test:floor')) {
        return {
          ran: true,
          code: 1,
          output: `2 file(s) FAILED:

──────── src/services/regression.test.ts ────────
 × my flaky test 523ms
some trace

──────── src/services/other.test.ts ────────
 × a new test 100ms
other trace
`,
        };
      }
      // other tests pass
      return { ran: true, code: 0, output: 'PASS' };
    };

    // Only one test is quarantined; the other is new
    const mockQuarantineData: TestQuarantineRow[] = [
      {
        project: 'test',
        test: 'my flaky test',
        quarantinedAtSha: 'abc123def456',
        evidence: { runs: 5, passRuns: 3, failRuns: 2 },
        ttlExpiresAt: Date.now() + 86400000,
        seededFrom: null,
        createdAt: Date.now(),
      },
    ];

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
      quarantineLookup: () => mockQuarantineData,
    });

    // Verify floor still failed because one entry is not quarantined
    expect(result.status).toBe('fail');
    expect(result.quarantinedOnlyFailures).toBeUndefined();
    expect(result.reasons.some((r) => r.includes('REGRESSION FLOOR FAILED'))).toBe(true);
  });
});
