/**
 * Fast lane: the teardown cases pass testCommand: 'exit 0' (no nested runner literal),
 * and only ever spell the argv pair worktree/list in their own calls — the real worktree
 * add is spawned inside runMutationProbe, never by this file's own source.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  classifyProbe,
  runMutationProbe,
  type ArmResult,
} from '../mutation-probe.js';

/** Build a real, committed git repo under mkdtempSync with a target symbol to probe. */
function makeProbeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mutprobe-repo-'));
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

describe('classifyProbe', () => {
  it('classifyProbe: vacuous when the control arm did not run or did not pass', () => {
    // Control did not run
    const result1 = classifyProbe(
      { ran: false, passed: false, exitCode: null, error: 'spawn failed' },
      { ran: true, passed: true, exitCode: 0 },
      { ran: true, passed: true, exitCode: 0 },
      false,
    );
    expect(result1.verdict).toBe('vacuous');
    expect(result1.execution).toBe('indeterminate');
    expect(result1.reason).toContain('control arm did not run');

    // Control ran but did not pass
    const result2 = classifyProbe(
      { ran: true, passed: false, exitCode: 1 },
      { ran: true, passed: true, exitCode: 0 },
      { ran: true, passed: true, exitCode: 0 },
      false,
    );
    expect(result2.verdict).toBe('vacuous');
    expect(result2.execution).toBe('indeterminate');
    expect(result2.reason).toContain('control arm did not pass');
  });

  it('classifyProbe: incident when an arm ran:false, never never-called', () => {
    const control = { ran: true, passed: true, exitCode: 0 };

    // Neutered arm did not run
    const result1 = classifyProbe(
      control,
      { ran: false, passed: false, exitCode: null, error: 'symbol not found' },
      { ran: true, passed: true, exitCode: 0 },
      false,
    );
    expect(result1.verdict).toBe('incident');
    expect(result1.execution).toBe('indeterminate');
    expect(result1.reason).toContain('neutered arm did not run');

    // Throw arm did not run
    const result2 = classifyProbe(
      control,
      { ran: true, passed: true, exitCode: 0 },
      { ran: false, passed: false, exitCode: null, error: 'symbol not found' },
      false,
    );
    expect(result2.verdict).toBe('incident');
    expect(result2.execution).toBe('indeterminate');
    expect(result2.reason).toContain('throw arm did not run');
  });

  it('classifyProbe: never-called when markerSeen is false and the throw arm ran', () => {
    const control = { ran: true, passed: true, exitCode: 0 };
    const neutered = { ran: true, passed: true, exitCode: 0 };
    const throwArm = { ran: true, passed: true, exitCode: 0 };

    const result = classifyProbe(control, neutered, throwArm, false);
    expect(result.verdict).toBe('graded');
    expect(result.execution).toBe('never-called');
    expect(result.reason).toBeUndefined();
  });

  it('classifyProbe: called-observed when markerSeen is true and the throw arm failed', () => {
    const control = { ran: true, passed: true, exitCode: 0 };
    const neutered = { ran: true, passed: true, exitCode: 0 };
    const throwArm = { ran: true, passed: false, exitCode: 1 };

    const result = classifyProbe(control, neutered, throwArm, true);
    expect(result.verdict).toBe('graded');
    expect(result.execution).toBe('called-observed');
    expect(result.reason).toBeUndefined();
  });

  it('classifyProbe: called-unobserved when markerSeen is true and the throw arm passed', () => {
    const control = { ran: true, passed: true, exitCode: 0 };
    const neutered = { ran: true, passed: true, exitCode: 0 };
    const throwArm = { ran: true, passed: true, exitCode: 0 };

    const result = classifyProbe(control, neutered, throwArm, true);
    expect(result.verdict).toBe('graded');
    expect(result.execution).toBe('called-unobserved');
    expect(result.reason).toBeUndefined();
  });

  it('a not-found symbol maps to incident/indeterminate, not never-called', () => {
    const control = { ran: true, passed: true, exitCode: 0 };
    const neuteredNotApplied = { ran: false, passed: false, exitCode: null, error: 'symbol "missing" not found' };
    const throwNotApplied = { ran: false, passed: false, exitCode: null, error: 'symbol "missing" not found' };

    // Neutered not applied
    const result1 = classifyProbe(control, neuteredNotApplied, throwNotApplied, false);
    expect(result1.verdict).toBe('incident');
    expect(result1.execution).toBe('indeterminate');

    // Throw not applied (even if marker is somehow false)
    const result2 = classifyProbe(control, { ran: true, passed: true, exitCode: 0 }, throwNotApplied, false);
    expect(result2.verdict).toBe('incident');
    expect(result2.execution).toBe('indeterminate');
  });
});

describe('runMutationProbe', () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
    tempDirs = [];
  });

  it('runMutationProbe tears down the trial worktree when the ArmRunner throws', async () => {
    const repo = makeProbeRepo();
    tempDirs.push(repo);
    let trial: string | undefined;

    await expect(
      runMutationProbe(
        {
          project: repo,
          repo,
          file: 'src/target.ts',
          symbol: 'targetSymbol',
          testCommand: 'exit 0',
        },
        {
          armRunner: async (arm, trialCwd) => {
            trial = trialCwd;
            expect(existsSync(trialCwd)).toBe(true);
            throw new Error('probe arm exploded');
          },
        },
      ),
    ).rejects.toThrow('probe arm exploded');

    expect(trial).toBeDefined();
    tempDirs.push(trial!);
    expect(trial).toMatch(/collab-mutation-probe-/);
    expect(existsSync(trial!)).toBe(false);

    const worktreeList = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
    expect(worktreeList).not.toContain(basename(trial!));
  });

  it('runMutationProbe tears down the trial worktree on the post-setup vacuous refusal', async () => {
    const repo = makeProbeRepo();
    tempDirs.push(repo);
    let trial: string | undefined;

    const result = await runMutationProbe(
      {
        project: repo,
        repo,
        file: 'src/target.ts',
        symbol: 'targetSymbol',
        testCommand: 'exit 0',
      },
      {
        armRunner: async (arm, trialCwd) => {
          trial = trialCwd;
          expect(existsSync(trialCwd)).toBe(true);
          return { ran: true, passed: false, exitCode: 1 };
        },
      },
    );

    expect(result.verdict).toBe('vacuous');

    expect(trial).toBeDefined();
    tempDirs.push(trial!);
    expect(trial).toMatch(/collab-mutation-probe-/);
    expect(existsSync(trial!)).toBe(false);

    const worktreeList = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
    expect(worktreeList).not.toContain(basename(trial!));
  });

  it('classifyProbe rule order: incidents never fall through to never-called', () => {
    const control = { ran: true, passed: true, exitCode: 0 };
    const notApplied = { ran: false, passed: false, exitCode: null, error: 'not found' };
    const nullMarker = false;

    // Even with markerSeen:false, a not-applied arm means incident, not never-called
    const result = classifyProbe(control, notApplied, notApplied, nullMarker);
    expect(result.verdict).toEqual('incident');
    expect(result.execution).toEqual('indeterminate');
  });

  it('classifyProbe: control failure always returns vacuous, even if markers suggest called', () => {
    const failedControl = { ran: false, passed: false, exitCode: null, error: 'timeout' };
    const workingArm = { ran: true, passed: true, exitCode: 0 };

    const result = classifyProbe(failedControl, workingArm, workingArm, true);
    expect(result.verdict).toBe('vacuous');
    expect(result.execution).toBe('indeterminate');
  });

  it('classifyProbe: all five outcomes are distinct', () => {
    const green = { ran: true, passed: true, exitCode: 0 };
    const red = { ran: true, passed: false, exitCode: 1 };
    const notRun = { ran: false, passed: false, exitCode: null };

    const vacuous = classifyProbe(notRun, green, green, false);
    const incident = classifyProbe(green, notRun, green, false);
    const nevercalled = classifyProbe(green, green, green, false);
    const observed = classifyProbe(green, green, red, true);
    const unobserved = classifyProbe(green, green, green, true);

    expect(vacuous.verdict).toBe('vacuous');
    expect(incident.verdict).toBe('incident');
    expect(nevercalled.verdict).toBe('graded');
    expect(observed.verdict).toBe('graded');
    expect(unobserved.verdict).toBe('graded');

    expect(nevercalled.execution).toBe('never-called');
    expect(observed.execution).toBe('called-observed');
    expect(unobserved.execution).toBe('called-unobserved');
  });
});
