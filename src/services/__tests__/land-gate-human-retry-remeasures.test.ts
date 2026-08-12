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
});
