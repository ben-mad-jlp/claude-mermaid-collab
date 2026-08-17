/**
 * Reconciliation test: verify that buildProbeResult downgrades
 * never-called + failing throw arm + no marker to indeterminate.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  buildProbeResult,
  runMutationProbe,
  type ArmResult,
  type MutationProbeResult,
} from '../mutation-probe.js';

/** Build a real, committed git repo under mkdtempSync with a target symbol to probe. */
function makeProbeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mutprobe-reconcile-'));
  execFileSync('git', ['-C', dir, 'init'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'probe@example.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Probe Test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'commit.gpgsign', 'false'], { stdio: 'ignore' });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'target.ts'), 'export function targetSymbol() { return 1; }\n');
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init'], { stdio: 'ignore' });
  return dir;
}

describe('mutation-probe-reconcile', () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
    tempDirs = [];
  });

  it('a failing throw arm never yields never-called', async () => {
    // Test 1: Direct buildProbeResult with ran:true, passed:false throw arm
    const fields1: MutationProbeResult = {
      project: 'test',
      file: 'src/target.ts',
      symbol: 'targetSymbol',
      testCommand: 'exit 0',
      control: { ran: true, passed: true, exitCode: 0 },
      neutered: { ran: true, passed: true, exitCode: 0 },
      throwArm: { ran: true, passed: false, exitCode: 1 },
      markerSeen: false,
      execution: 'never-called',
      verdict: 'graded',
    };

    const result1 = buildProbeResult(fields1);
    expect(result1.execution).not.toBe('never-called');
    expect(['called-unobserved', 'indeterminate']).toContain(result1.execution);

    // Test 2: Direct buildProbeResult with ran:false, passed:false throw arm
    const fields2: MutationProbeResult = {
      project: 'test',
      file: 'src/target.ts',
      symbol: 'targetSymbol',
      testCommand: 'exit 0',
      control: { ran: true, passed: true, exitCode: 0 },
      neutered: { ran: true, passed: true, exitCode: 0 },
      throwArm: { ran: false, passed: false, exitCode: null },
      markerSeen: false,
      execution: 'never-called',
      verdict: 'graded',
    };

    const result2 = buildProbeResult(fields2);
    expect(result2.execution).not.toBe('never-called');
    expect(['called-unobserved', 'indeterminate']).toContain(result2.execution);

    // Test 3: Through runMutationProbe with injected seams
    const repo = makeProbeRepo();
    tempDirs.push(repo);

    const stubArmRunner = async (arm: 'control' | 'neutered' | 'throw', trialCwd: string, testCommand: string, markerPath: string): Promise<ArmResult> => {
      if (arm === 'control' || arm === 'neutered') {
        return { ran: true, passed: true, exitCode: 0 };
      }
      // throw arm: always fail, and never create the marker file
      return { ran: true, passed: false, exitCode: 1 };
    };

    const result = await runMutationProbe(
      {
        project: 'test',
        repo,
        file: 'src/target.ts',
        symbol: 'targetSymbol',
        testCommand: 'exit 0',
      },
      {
        armRunner: stubArmRunner,
        rewrite: {
          neuter: (source: string, symbol: string) => ({
            applied: true,
            source: source.replace(`function ${symbol}`, `function ${symbol}_neutered`),
          }),
          throwProbe: (source: string, symbol: string) => ({
            applied: true,
            source: source.replace(`function ${symbol}`, `function ${symbol}_throw`),
          }),
        },
      },
    );

    // The stub runner never creates the marker, and throw arm failed (passed:false)
    // buildProbeResult should reconcile never-called + failing throw arm → indeterminate
    expect(result.execution).not.toBe('never-called');
    expect(['called-unobserved', 'indeterminate']).toContain(result.execution);
  });
});
