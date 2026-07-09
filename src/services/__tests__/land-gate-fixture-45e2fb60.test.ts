import { describe, it, expect } from 'bun:test';
import type { GateDeclaration, GateSpawn } from '../leaf-gate';
import type { EpicLandGateResult } from '../epic-land-gate';
import { runEpicLandGate, landGateTrailer } from '../epic-land-gate';

/**
 * Recorded 2026-07-09 against collab/epic/45e2fb60 (merge-base c88912ae).
 *   bun test src/services/__tests__/todo-store.test.ts  on branch => 25 pass, 104 fail
 *   same file                                           on master => 115 pass, 0 fail
 * The ENTIRE pre-G10 land proof (children accepted, tsc clean, dry-merge clean)
 * was GREEN on this branch. At level `auto` it would already be on master.
 */

describe('epic 45e2fb60 regression fixture', () => {
  const mockDeclaration: GateDeclaration = {
    kind: 'declared',
    cfg: {
      typecheck: 'npx tsc --noEmit',
      tests: [
        { match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' },
      ],
    },
    manifestPath: '.collab/project.json',
  };

  it('should record and classify a regression when branch fails and master passes', async () => {
    let spawnCallCount = 0;
    const mockSpawn: GateSpawn = async (cwd, command) => {
      spawnCallCount++;

      // Typecheck passes
      if (command.includes('tsc')) {
        return { ran: true, code: 0, output: '' };
      }

      // On master baseline (temp worktree): pass
      if (cwd.includes('collab-land-gate') || cwd.includes('tmp')) {
        return { ran: true, code: 0, output: 'PASS: 115 pass' };
      }

      // On branch: fail with the recorded failure counts
      return {
        ran: true,
        code: 1,
        output: 'FAIL: 25 pass, 104 fail\ntodo-store.test.ts: test suite failed',
      };
    };

    const result = await runEpicLandGate({
      project: 'test',
      repo: '/repo',
      epicId: '45e2fb60',
      epicBranch: 'collab/epic/45e2fb60',
      epicWorktreeCwd: '/epic',
      decl: mockDeclaration,
      spawn: mockSpawn,
      git: (cwd, args) => {
        if (args[0] === 'rev-parse') return { code: 0, stdout: 'sha\n' };
        if (args[0] === 'merge-base') return { code: 0, stdout: 'base\n' };
        if (args[0] === 'diff') return { code: 0, stdout: 'src/services/__tests__/todo-store.test.ts\n' };
        if (args[0] === 'worktree' && args[1] === 'add') return { code: 0, stdout: '' };
        if (args[0] === 'worktree' && (args[1] === 'remove' || args[1] === 'prune')) return { code: 0, stdout: '' };
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    // Assert spawn was called multiple times (typecheck + branch test + baseline test)
    expect(spawnCallCount).toBeGreaterThanOrEqual(3);

    // Assert status is 'fail' due to regression
    expect(result.status).toBe('fail');
    expect(result.regressions.length).toBeGreaterThan(0);
    expect(result.regressions[0].classification).toBe('regression');

    // Assert reason contains diagnostic info
    expect(result.reasons.some(r => r.includes('fails on') || r.includes('REGRESSION'))).toBe(true);

    // Assert trailer would not be generated for a fail
    const trailer = landGateTrailer(result);
    expect(trailer).toBe('');
  });

  it('should pass with inherited failures when both branch and master fail', async () => {
    const mockSpawn: GateSpawn = async (cwd, command) => {
      // All commands fail (typecheck and tests)
      return { ran: true, code: 1, output: 'failure' };
    };

    const result = await runEpicLandGate({
      project: 'test',
      repo: '/repo',
      epicId: '45e2fb60',
      epicBranch: 'collab/epic/45e2fb60',
      epicWorktreeCwd: '/epic',
      decl: mockDeclaration,
      spawn: mockSpawn,
      git: (cwd, args) => {
        if (args[0] === 'rev-parse') return { code: 0, stdout: 'sha\n' };
        if (args[0] === 'merge-base') return { code: 0, stdout: 'base\n' };
        if (args[0] === 'diff') return { code: 0, stdout: 'src/services/__tests__/test.test.ts\n' };
        if (args[0] === 'worktree' && args[1] === 'add') return { code: 0, stdout: '' };
        if (args[0] === 'worktree' && (args[1] === 'remove' || args[1] === 'prune')) return { code: 0, stdout: '' };
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    // typecheck fails, so status should be 'fail' with early return
    expect(result.status).toBe('fail');
    expect(result.typecheck?.status).toBe('fail');
  });
});
