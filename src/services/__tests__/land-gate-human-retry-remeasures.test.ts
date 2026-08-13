import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GateDeclaration, GateSpawn } from '../leaf-gate';
import type { EpicLandGateResult } from '../epic-land-gate';
import { runEpicLandGate } from '../epic-land-gate';
import { landReadiness } from '../land-authority';
import { getEpicLandGate } from '../worker-ledger';
import type { EpicLandGateOpts } from '../epic-land-gate';

describe('land-gate-human-retry-remeasures', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('human actor re-runs the floor at identical shas after a cached fail', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'land-gate-human-retry-'));

    const fixedSha = 'deadbeef0123456789abcdef0123456789abcd';
    const baseSha = 'deadbeef1111111111111111111111111111111';

    const mockDeclaration: GateDeclaration = {
      kind: 'declared',
      cfg: {
        tests: [{ match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' }],
        floors: [{ match: new RegExp('^src/'), command: 'bun run test:floor' }],
      },
      manifestPath: '.collab/project.json',
    };

    const spawnCalls: string[] = [];
    const mockSpawn: GateSpawn = async (cwd, command) => {
      spawnCalls.push(command);

      if (command.includes('tsc')) {
        return { ran: true, code: 0, output: 'OK' };
      }
      // Floor command fails on first invocation
      if (command.includes('test:floor')) {
        return { ran: true, code: 1, output: 'Floor test failed' };
      }
      return { ran: true, code: 0, output: 'PASS' };
    };

    const result = await runEpicLandGate({
      project: tmpDir,
      repo: tmpDir,
      epicId: 'test-epic-123',
      epicBranch: 'collab/epic/test',
      epicWorktreeCwd: tmpDir,
      decl: mockDeclaration,
      spawn: mockSpawn,
      snapshot: { epicTipSha: fixedSha, baseSha },
      actor: { kind: 'human' },
      git: (cwd, args) => {
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'src/services/foo.ts\n' };
        }
        if (args[0] === 'merge-base') {
          return { code: 0, stdout: `${baseSha}\n` };
        }
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    // Assert floor was invoked once
    expect(spawnCalls.filter((c) => c.includes('test:floor')).length).toBe(1);
    // Assert the result reflects the failure
    expect(result.floor?.status).toBe('fail');
    expect(result.status).toBe('fail');
    // Assert recordEpicLandGate persisted the row
    const recorded = getEpicLandGate('test-epic-123', fixedSha, baseSha);
    expect(recorded).toBeDefined();
    expect(recorded?.status).toBe('fail');
  });

  it('daemon actor at identical shas serves the cached row with zero floor invocations', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'land-gate-daemon-cache-'));

    const fixedSha = 'deadbeef0123456789abcdef0123456789abcd';
    const baseSha = 'deadbeef1111111111111111111111111111111';

    const mockDeclaration: GateDeclaration = {
      kind: 'declared',
      cfg: {
        tests: [{ match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' }],
        floors: [{ match: new RegExp('^src/'), command: 'bun run test:floor' }],
      },
      manifestPath: '.collab/project.json',
    };

    const spawnCalls: string[] = [];
    const mockSpawn: GateSpawn = async (cwd, command) => {
      spawnCalls.push(command);

      if (command.includes('tsc')) {
        return { ran: true, code: 0, output: 'OK' };
      }
      if (command.includes('test:floor')) {
        return { ran: true, code: 1, output: 'Floor test failed' };
      }
      return { ran: true, code: 0, output: 'PASS' };
    };

    // First run: populate the cache with a human actor
    await runEpicLandGate({
      project: tmpDir,
      repo: tmpDir,
      epicId: 'test-epic-456',
      epicBranch: 'collab/epic/test2',
      epicWorktreeCwd: tmpDir,
      decl: mockDeclaration,
      spawn: mockSpawn,
      snapshot: { epicTipSha: fixedSha, baseSha },
      actor: { kind: 'human' },
      git: (cwd, args) => {
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'src/services/foo.ts\n' };
        }
        if (args[0] === 'merge-base') {
          return { code: 0, stdout: `${baseSha}\n` };
        }
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    spawnCalls.length = 0; // Reset spawn calls

    // Second run: daemon actor with identical shas should use cache
    const daemonResult = await runEpicLandGate({
      project: tmpDir,
      repo: tmpDir,
      epicId: 'test-epic-456',
      epicBranch: 'collab/epic/test2',
      epicWorktreeCwd: tmpDir,
      decl: mockDeclaration,
      spawn: mockSpawn,
      snapshot: { epicTipSha: fixedSha, baseSha },
      actor: { kind: 'daemon', level: 'auto' },
      git: (cwd, args) => {
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'src/services/foo.ts\n' };
        }
        if (args[0] === 'merge-base') {
          return { code: 0, stdout: `${baseSha}\n` };
        }
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
    });

    // Assert floor was NOT invoked for daemon actor
    expect(spawnCalls.filter((c) => c.includes('test:floor')).length).toBe(0);
    // Assert the result matches the cached status
    expect(daemonResult.status).toBe('fail');
    expect(daemonResult.floor?.status).toBe('fail');
  });

  it('human actor re-runs the floor when explicitly retrying at identical shas', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'land-gate-human-rerun-'));

    const fixedSha = 'deadbeef0123456789abcdef0123456789abcd';
    const baseSha = 'deadbeef2222222222222222222222222222222';

    const mockDeclaration: GateDeclaration = {
      kind: 'declared',
      cfg: {
        tests: [{ match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' }],
        floors: [{ match: new RegExp('^src/'), command: 'bun run test:floor' }],
      },
      manifestPath: '.collab/project.json',
    };

    let floorInvocationCount = 0;
    const mockSpawn: GateSpawn = async (cwd, command) => {
      if (command.includes('tsc')) {
        return { ran: true, code: 0, output: 'OK' };
      }
      // First time: floor fails, second time: floor passes
      if (command.includes('test:floor')) {
        floorInvocationCount++;
        if (floorInvocationCount === 1) {
          return { ran: true, code: 1, output: 'Floor test failed initially' };
        } else {
          return { ran: true, code: 0, output: 'Floor test passed on retry' };
        }
      }
      return { ran: true, code: 0, output: 'PASS' };
    };

    // First run: human actor, floor fails
    const result1 = await runEpicLandGate({
      project: tmpDir,
      repo: tmpDir,
      epicId: 'test-epic-789',
      epicBranch: 'collab/epic/test3',
      epicWorktreeCwd: tmpDir,
      decl: mockDeclaration,
      spawn: mockSpawn,
      snapshot: { epicTipSha: fixedSha, baseSha },
      actor: { kind: 'human' },
      git: (cwd, args) => {
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'src/services/foo.ts\n' };
        }
        if (args[0] === 'merge-base') {
          return { code: 0, stdout: `${baseSha}\n` };
        }
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    expect(result1.floor?.status).toBe('fail');
    expect(floorInvocationCount).toBe(1);

    // Second run: human actor retry at identical shas, floor passes this time
    const result2 = await runEpicLandGate({
      project: tmpDir,
      repo: tmpDir,
      epicId: 'test-epic-789',
      epicBranch: 'collab/epic/test3',
      epicWorktreeCwd: tmpDir,
      decl: mockDeclaration,
      spawn: mockSpawn,
      snapshot: { epicTipSha: fixedSha, baseSha },
      actor: { kind: 'human' },
      git: (cwd, args) => {
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'src/services/foo.ts\n' };
        }
        if (args[0] === 'merge-base') {
          return { code: 0, stdout: `${baseSha}\n` };
        }
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
    });

    // Assert floor was invoked a SECOND time despite cache
    expect(floorInvocationCount).toBe(2);
    // Assert the result reflects the second invocation's pass
    expect(result2.floor?.status).toBe('pass');
    expect(result2.status).toBe('pass');
  });

  it('landReadiness hands the human actor to the gate probe', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'land-readiness-actor-'));

    const capturedOpts: EpicLandGateOpts[] = [];

    const readinessResult = await landReadiness(tmpDir, 'test-epic-actor', {
      probes: {
        gate: async (opts) => {
          capturedOpts.push(opts);
          const result: EpicLandGateResult = {
            status: 'pass',
            declared: false,
            manifestPath: '',
            units: [],
            regressions: [],
            inherited: [],
            incidents: [],
            reasons: [],
            specFiles: [],
            epicTipSha: null,
            baseSha: null,
          };
          return result;
        },
        todos: () => [],
        merge: () => ({ tscClean: true, mergeClean: true }),
      },
      actor: { kind: 'human' },
    });

    expect(capturedOpts.length).toBe(1);
    expect(capturedOpts[0].actor).toEqual({ kind: 'human' });
  });

  it('skipCache: true forces re-run regardless of actor kind', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'land-gate-skipCache-'));

    const fixedSha = 'deadbeef0123456789abcdef0123456789abcd';
    const baseSha = 'deadbeef3333333333333333333333333333333';

    const mockDeclaration: GateDeclaration = {
      kind: 'declared',
      cfg: {
        tests: [{ match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' }],
        floors: [{ match: new RegExp('^src/'), command: 'bun run test:floor' }],
      },
      manifestPath: '.collab/project.json',
    };

    let floorInvocationCount = 0;
    const mockSpawn: GateSpawn = async (cwd, command) => {
      if (command.includes('tsc')) {
        return { ran: true, code: 0, output: 'OK' };
      }
      if (command.includes('test:floor')) {
        floorInvocationCount++;
        return { ran: true, code: 0, output: 'Floor passed' };
      }
      return { ran: true, code: 0, output: 'PASS' };
    };

    // First run: populate the cache
    await runEpicLandGate({
      project: tmpDir,
      repo: tmpDir,
      epicId: 'test-epic-skip',
      epicBranch: 'collab/epic/testskip',
      epicWorktreeCwd: tmpDir,
      decl: mockDeclaration,
      spawn: mockSpawn,
      snapshot: { epicTipSha: fixedSha, baseSha },
      actor: { kind: 'daemon', level: 'auto' },
      git: (cwd, args) => {
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'src/services/foo.ts\n' };
        }
        if (args[0] === 'merge-base') {
          return { code: 0, stdout: `${baseSha}\n` };
        }
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    floorInvocationCount = 0;

    // Second run: daemon actor with skipCache: true should still re-run
    await runEpicLandGate({
      project: tmpDir,
      repo: tmpDir,
      epicId: 'test-epic-skip',
      epicBranch: 'collab/epic/testskip',
      epicWorktreeCwd: tmpDir,
      decl: mockDeclaration,
      spawn: mockSpawn,
      snapshot: { epicTipSha: fixedSha, baseSha },
      actor: { kind: 'daemon', level: 'auto' },
      git: (cwd, args) => {
        if (args[0] === 'diff') {
          return { code: 0, stdout: 'src/services/foo.ts\n' };
        }
        if (args[0] === 'merge-base') {
          return { code: 0, stdout: `${baseSha}\n` };
        }
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    // Assert floor was re-invoked because skipCache: true overrides caching regardless of actor
    expect(floorInvocationCount).toBe(1);
  });

  it('a cached FAIL whose failing set is now fully quarantined is re-measured, not served', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'land-gate-quarantine-invalidates-cache-'));

    const fixedSha = 'deadbeef0123456789abcdef0123456789abcd';
    const baseSha = 'deadbeef3333333333333333333333333333333';

    const mockDeclaration: GateDeclaration = {
      kind: 'declared',
      cfg: {
        tests: [{ match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' }],
        floors: [{ match: new RegExp('^src/'), command: 'bun run test:floor' }],
      },
      manifestPath: '.collab/project.json',
    };

    const floorOutput = `1 file(s) FAILED:

──────── src/services/flaky.test.ts ────────
 × flaked under load 523ms
`;
    const spawnCalls: string[] = [];
    const mockSpawn: GateSpawn = async (cwd, command) => {
      spawnCalls.push(command);
      if (command.includes('tsc')) return { ran: true, code: 0, output: 'OK' };
      if (command.includes('test:floor')) return { ran: true, code: 1, output: floorOutput };
      return { ran: true, code: 0, output: 'PASS' };
    };
    const mockGit = (cwd: string, args: string[]) => {
      if (args[0] === 'diff') return { code: 0, stdout: 'src/services/foo.ts\n' };
      if (args[0] === 'merge-base') return { code: 0, stdout: `${baseSha}\n` };
      return { code: 1, stdout: '' };
    };
    const baseOpts = {
      project: tmpDir,
      repo: tmpDir,
      epicId: 'test-epic-quar-cache',
      epicBranch: 'collab/epic/testq',
      epicWorktreeCwd: tmpDir,
      decl: mockDeclaration,
      spawn: mockSpawn,
      snapshot: { epicTipSha: fixedSha, baseSha },
      git: mockGit,
      fs: { exists: () => true, symlink: () => {} },
    };

    // First run (no quarantine): floor fails, FAIL is cached.
    await runEpicLandGate({ ...baseOpts, actor: { kind: 'human' }, skipCache: true, quarantineLookup: () => [] });
    expect(getEpicLandGate('test-epic-quar-cache', fixedSha, baseSha)?.status).toBe('fail');
    spawnCalls.length = 0;

    // Second run as a NON-human actor with the failing file now quarantined: the cached
    // fail predates the quarantine row, so the gate must re-measure instead of serving it.
    const retried = await runEpicLandGate({
      ...baseOpts,
      actor: { kind: 'daemon', level: 'auto' },
      quarantineLookup: () => [
        {
          project: tmpDir,
          test: 'src/services/flaky.test.ts',
          quarantinedAtSha: 'manual',
          evidence: { runs: 0, passRuns: 0, failRuns: 0 },
          ttlExpiresAt: Date.now() + 86_400_000,
          seededFrom: 'manual',
          createdAt: Date.now(),
        },
      ],
    });

    // Re-measured (floor re-invoked) and downgraded to pass via the quarantined-only path.
    expect(spawnCalls.filter((c) => c.includes('test:floor')).length).toBe(1);
    expect(retried.status).toBe('pass');
    expect(retried.quarantinedOnlyFailures).toEqual(['src/services/flaky.test.ts']);

    // A cached fail NOT covered by quarantine is still served untouched.
    spawnCalls.length = 0;
    const uncovered = await runEpicLandGate({
      ...baseOpts,
      actor: { kind: 'daemon', level: 'auto' },
      quarantineLookup: () => [],
    });
    expect(spawnCalls.filter((c) => c.includes('test:floor')).length).toBe(0);
    expect(uncovered.status).toBe('pass'); // second run's downgraded pass is now the cached row
  });
});
