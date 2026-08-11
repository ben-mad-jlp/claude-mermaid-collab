import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GateDeclaration, GateSpawn } from '../leaf-gate';
import type { EpicLandGateResult } from '../epic-land-gate';
import { runEpicLandGate } from '../epic-land-gate';
import { landReadiness } from '../land-authority';
import { getEpicLandGate } from '../worker-ledger';

describe('land gate fails closed when merge-base == epic tip', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('returns status fail and blocks landReadiness when merge-base equals the epic tip', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'land-gate-unevaluable-'));

    // Use a fixed SHA to represent both epic tip and merge-base
    const fixedSha = 'deadbeef0123456789abcdef0123456789abcd';

    const mockDeclaration: GateDeclaration = {
      kind: 'declared',
      cfg: {
        tests: [{ match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' }],
      },
      manifestPath: '.collab/project.json',
    };

    const mockSpawn: GateSpawn = async (cwd, command) => {
      return { ran: true, code: 0, output: '' };
    };

    const result = await runEpicLandGate({
      project: tmpDir,
      repo: tmpDir,
      epicId: 'test-epic-123',
      epicBranch: 'collab/epic/test',
      epicWorktreeCwd: tmpDir,
      decl: mockDeclaration,
      spawn: mockSpawn,
      // Use snapshot to skip rev-parse calls and set both to the same SHA
      snapshot: { epicTipSha: fixedSha, baseSha: fixedSha },
      git: (cwd, args) => {
        // merge-base returns the fixed SHA (equal to epic tip)
        if (args[0] === 'merge-base') {
          return { code: 0, stdout: `${fixedSha}\n` };
        }
        return { code: 1, stdout: '' };
      },
      fs: { exists: () => true, symlink: () => {} },
      skipCache: true,
    });

    // Assert the gate returns status: 'fail'
    expect(result.status).toBe('fail');

    // Assert the reason includes "merge-base == epic tip"
    expect(result.reasons.some((r) => r.includes('merge-base == epic tip'))).toBe(true);

    // Assert regressions and incidents are empty
    expect(result.regressions.length).toBe(0);
    expect(result.incidents.length).toBe(0);

    // Assert a land gate row was recorded
    const recorded = getEpicLandGate('test-epic-123', fixedSha, fixedSha);
    expect(recorded).toBeDefined();
    expect(recorded?.status).toBe('fail');

    // Feed the result into landReadiness and verify it produces a gate-failed blocker
    const readinessResult = await landReadiness(tmpDir, 'test-epic-123', {
      probes: {
        gate: async () => result,
        todos: () => [],
      },
    });

    // Assert a blocker with code 'gate-failed' exists
    const gateFailedBlocker = readinessResult.blockers.find((b) => b.code === 'gate-failed');
    expect(gateFailedBlocker).toBeDefined();
    expect(gateFailedBlocker?.message).toMatch(/merge-base == epic tip/);

    // Assert the readiness verdict is not green
    expect(readinessResult.green).toBe(false);
  });
});
