/**
 * Mutation probe engine: three-arm probe testing for dead code and reachability.
 *
 * Runs a test command against three variants of a source file:
 * 1. control: unmodified source
 * 2. neutered: the target symbol is replaced with a no-op
 * 3. throw arm: the target symbol is modified to throw and write a marker file
 *
 * The throw arm's marker presence tells whether the symbol was CALLED;
 * whether the throw arm PASSED tells whether the execution is OBSERVED
 * (throw → execution observed, pass → not observed).
 *
 * Pure verdict logic + an injected ArmRunner seam (so tests stub it) +
 * a worktree-backed default runner (scratch worktree lifecycle).
 * Read-only: no work-graph mutation, no landing, no pushing.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadProjectManifest } from '../config/project-manifest.js';
import { resolveSuiteCommands } from './verify-epic.js';
import { neuterSymbol, throwProbeSymbol } from './mutation-probe-rewrite.js';
import { listUntrackedPaths } from './stage-untracked.js';
import { mutationProbeTempRoot, MUTATION_PROBE_TEMP_PREFIX } from './mutation-probe-temp.js';

/** Result of running ONE arm (control, neutered, or throw).
 *  `ran:false` is an INCIDENT — the arm could not be executed at all
 *  (symbol not found, spawn failure) — DISTINCT from ran:true with passed:false. */
export interface ArmResult {
  ran: boolean;
  passed: boolean;
  exitCode: number | null;
  error?: string;
}

/** Execution signal derived from the three-arm run and marker presence.
 *  - 'never-called': the symbol was not invoked
 *  - 'called-observed': the symbol was called and the throw was executed
 *  - 'called-unobserved': the symbol was called but the throw was suppressed
 *  - 'indeterminate': an incident prevented classification */
export type ExecutionSignal = 'called-observed' | 'called-unobserved' | 'never-called' | 'indeterminate';

/** Final verdict from classifyProbe.
 *  - 'vacuous': the control arm did not run or failed — no usable signal
 *  - 'incident': a mutation arm could not be applied or run
 *  - 'graded': normal execution signal (execution set to one of the four outcomes) */
export type ProbeVerdict = 'vacuous' | 'incident' | 'graded';

/** Injected runner: given the arm name, trial worktree cwd, test command,
 *  and marker path, execute the test and return arm outcome.
 *  Mirrors the SuiteRunner seam pattern. */
export type ArmRunner = (
  arm: 'control' | 'neutered' | 'throw',
  trialCwd: string,
  testCommand: string,
  markerPath: string,
) => Promise<ArmResult>;

/** Full result of a mutation probe run. */
export interface MutationProbeResult {
  project: string;
  file: string;
  symbol: string;
  testCommand: string;
  control: ArmResult;
  neutered: ArmResult;
  throwArm: ArmResult;
  markerSeen: boolean;
  execution: ExecutionSignal;
  verdict: ProbeVerdict;
  reason?: string;
}

/** Classify probe results in rule order: vacuous → incident → graded.
 *  Pure function, no I/O.
 *  Rules:
 *  1. if control did not run or did not pass → vacuous
 *  2. if any arm ran:false (rewrite not applied or spawn failure) → incident
 *  3. if marker not seen → never-called
 *  4. if marker seen and throw arm failed → called-observed
 *  5. if marker seen and throw arm passed → called-unobserved */
export function classifyProbe(
  control: ArmResult,
  neutered: ArmResult,
  throwArm: ArmResult,
  markerSeen: boolean,
): { execution: ExecutionSignal; verdict: ProbeVerdict; reason?: string } {
  // Rule 1: control arm failed → vacuous (no usable ground truth)
  if (!control.ran || !control.passed) {
    return {
      verdict: 'vacuous',
      execution: 'indeterminate',
      reason: !control.ran
        ? `control arm did not run: ${control.error ?? 'unknown failure'}`
        : 'control arm did not pass (baseline suite is red)',
    };
  }

  // Rule 2: any arm did not run → incident (mutation not applied or spawn failed)
  if (!control.ran || !neutered.ran || !throwArm.ran) {
    return {
      verdict: 'incident',
      execution: 'indeterminate',
      reason: !neutered.ran
        ? `neutered arm did not run: ${neutered.error ?? 'mutation not applied'}`
        : !throwArm.ran
          ? `throw arm did not run: ${throwArm.error ?? 'mutation not applied'}`
          : 'control arm did not run',
    };
  }

  // Rule 3: marker not seen → never-called
  if (!markerSeen) {
    return { verdict: 'graded', execution: 'never-called' };
  }

  // Rule 4: marker seen and throw arm failed → called-observed
  if (!throwArm.passed) {
    return { verdict: 'graded', execution: 'called-observed' };
  }

  // Rule 5: marker seen and throw arm passed → called-unobserved
  return { verdict: 'graded', execution: 'called-unobserved' };
}

/** Options for runMutationProbe. */
export interface MutationProbeOpts {
  project: string;
  repo: string;
  file: string;
  symbol: string;
  testCommand?: string;
}

/** Dependencies for runMutationProbe (seams for testing). */
export interface MutationProbeDeps {
  armRunner?: ArmRunner;
  rewrite?: {
    neuter: typeof neuterSymbol;
    throwProbe: typeof throwProbeSymbol;
  };
}

/** Default ArmRunner: spawn the test command via `sh -c` in the trial worktree.
 *  Follows the defaultGateSpawn pattern: ran:false on spawn error or signal death. */
const defaultArmRunner: ArmRunner = async (arm, trialCwd, testCommand, markerPath) => {
  try {
    const proc = Bun.spawn(['sh', '-c', testCommand], {
      cwd: trialCwd,
      env: { ...process.env, MUTATION_PROBE_MARKER: markerPath },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (proc.signalCode != null) {
      return { ran: false, passed: false, exitCode: null, error: 'signal or timeout' };
    }

    return { ran: true, passed: code === 0, exitCode: code };
  } catch (e) {
    return {
      ran: false,
      passed: false,
      exitCode: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

/** Run a mutation probe: set up a trial worktree, apply three mutations,
 *  run the test command in each, and classify the results.
 *  Worktree is removed in finally block on all exit paths. */
export async function runMutationProbe(
  opts: MutationProbeOpts,
  deps?: MutationProbeDeps,
): Promise<MutationProbeResult> {
  const { project, repo, file, symbol } = opts;
  const rewrite = deps?.rewrite ?? { neuter: neuterSymbol, throwProbe: throwProbeSymbol };
  const armRunner = deps?.armRunner ?? defaultArmRunner;

  // Resolve test command
  let testCommand = opts.testCommand;
  if (!testCommand) {
    const suites = resolveSuiteCommands(project);
    testCommand = suites[0]?.command;
  }
  if (!testCommand) {
    return {
      project,
      file,
      symbol,
      testCommand: '',
      control: { ran: false, passed: false, exitCode: null, error: 'no test command resolved' },
      neutered: { ran: false, passed: false, exitCode: null },
      throwArm: { ran: false, passed: false, exitCode: null },
      markerSeen: false,
      execution: 'indeterminate',
      verdict: 'incident',
      reason: 'no test command resolved from project manifest',
    };
  }

  // Set up trial worktree
  mkdirSync(mutationProbeTempRoot(), { recursive: true });
  const trial = join(mutationProbeTempRoot(), `${MUTATION_PROBE_TEMP_PREFIX}${process.pid}-${process.hrtime.bigint()}`);
  const teardown = () => {
    try { execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', trial], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { execFileSync('git', ['-C', repo, 'worktree', 'prune'], { stdio: 'ignore' }); } catch { /* ignore */ }
  };

  try {
    // Add detached worktree
    try {
      execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', trial, 'HEAD'], { stdio: 'ignore' });
    } catch (e) {
      return {
        project,
        file,
        symbol,
        testCommand,
        control: { ran: false, passed: false, exitCode: null, error: 'could not create trial worktree' },
        neutered: { ran: false, passed: false, exitCode: null },
        throwArm: { ran: false, passed: false, exitCode: null },
        markerSeen: false,
        execution: 'indeterminate',
        verdict: 'incident',
        reason: 'trial worktree setup failed',
      };
    }

    // Symlink node_modules at repo root and immediate subdirs (ui/, desktop/)
    const symlinkCwds = new Set<string>(['', 'ui', 'desktop']);
    for (const cwd of symlinkCwds) {
      const srcModules = join(cwd ? join(repo, cwd) : repo, 'node_modules');
      if (existsSync(srcModules)) {
        const trialModules = join(trial, cwd, 'node_modules');
        try {
          mkdirSync(join(trial, cwd), { recursive: true });
          symlinkSync(srcModules, trialModules);
        } catch {
          // best-effort; continue even if symlink fails
        }
      }
    }

    // Overlay uncommitted state: apply diff and copy untracked files
    try {
      const diffOut = execFileSync('git', ['-C', repo, 'diff', 'HEAD', '--binary'], {
        stdio: 'pipe',
        encoding: 'utf8',
        maxBuffer: 50_000_000,
      });
      if (diffOut.length > 0) {
        try {
          execFileSync('git', ['-C', trial, 'apply', '--binary', '-'], {
            input: diffOut,
            stdio: 'pipe',
          });
        } catch (e) {
          return {
            project,
            file,
            symbol,
            testCommand,
            control: { ran: false, passed: false, exitCode: null, error: 'could not apply diff to trial' },
            neutered: { ran: false, passed: false, exitCode: null },
            throwArm: { ran: false, passed: false, exitCode: null },
            markerSeen: false,
            execution: 'indeterminate',
            verdict: 'incident',
            reason: 'failed to apply uncommitted changes to trial worktree',
          };
        }
      }
    } catch (e) {
      // diff might fail if repo is not a git tree, continue anyway
    }

    // Copy untracked files
    const untrackedPaths = listUntrackedPaths(repo);
    for (const path of untrackedPaths) {
      const srcPath = join(repo, path);
      const trialPath = join(trial, path);
      try {
        mkdirSync(join(trial, ...path.split('/').slice(0, -1)), { recursive: true });
        const content = readFileSync(srcPath);
        writeFileSync(trialPath, content);
      } catch {
        // best-effort; skip untrackable files
      }
    }

    // Read the source file in the trial
    let sourceContent: string;
    try {
      sourceContent = readFileSync(join(trial, file), 'utf8');
    } catch (e) {
      return {
        project,
        file,
        symbol,
        testCommand,
        control: { ran: false, passed: false, exitCode: null, error: `could not read ${file} from trial` },
        neutered: { ran: false, passed: false, exitCode: null },
        throwArm: { ran: false, passed: false, exitCode: null },
        markerSeen: false,
        execution: 'indeterminate',
        verdict: 'incident',
        reason: `failed to read file ${file} from trial worktree`,
      };
    }

    // Marker path
    const markerPath = join(tmpdir(), `mutation-probe-marker-${process.hrtime.bigint()}`);

    // Run control arm (unmodified)
    const controlResult = await armRunner('control', trial, testCommand, markerPath);

    // If control failed, return early with vacuous/incident
    const preClassify = classifyProbe(controlResult, { ran: false, passed: false, exitCode: null }, { ran: false, passed: false, exitCode: null }, false);
    if (preClassify.verdict === 'vacuous') {
      return {
        project,
        file,
        symbol,
        testCommand,
        control: controlResult,
        neutered: { ran: false, passed: false, exitCode: null },
        throwArm: { ran: false, passed: false, exitCode: null },
        markerSeen: false,
        execution: preClassify.execution,
        verdict: preClassify.verdict,
        reason: preClassify.reason,
      };
    }

    // Apply neutered mutation
    const neuteredRewrite = rewrite.neuter(sourceContent, symbol);
    if (!neuteredRewrite.applied) {
      const classification = classifyProbe(controlResult, { ran: false, passed: false, exitCode: null, error: neuteredRewrite.reason }, { ran: false, passed: false, exitCode: null }, false);
      return {
        project,
        file,
        symbol,
        testCommand,
        control: controlResult,
        neutered: { ran: false, passed: false, exitCode: null, error: neuteredRewrite.reason },
        throwArm: { ran: false, passed: false, exitCode: null },
        markerSeen: false,
        execution: classification.execution,
        verdict: classification.verdict,
        reason: classification.reason,
      };
    }

    // Run neutered arm
    writeFileSync(join(trial, file), neuteredRewrite.source);
    const neuteredResult = await armRunner('neutered', trial, testCommand, markerPath);

    // Apply throw mutation
    const throwRewrite = rewrite.throwProbe(sourceContent, symbol);
    if (!throwRewrite.applied) {
      const classification = classifyProbe(controlResult, neuteredResult, { ran: false, passed: false, exitCode: null, error: throwRewrite.reason }, false);
      return {
        project,
        file,
        symbol,
        testCommand,
        control: controlResult,
        neutered: neuteredResult,
        throwArm: { ran: false, passed: false, exitCode: null, error: throwRewrite.reason },
        markerSeen: false,
        execution: classification.execution,
        verdict: classification.verdict,
        reason: classification.reason,
      };
    }

    // Run throw arm
    writeFileSync(join(trial, file), throwRewrite.source);
    const throwResult = await armRunner('throw', trial, testCommand, markerPath);

    // Check marker presence
    const markerSeen = existsSync(markerPath);

    // Classify final result
    const classification = classifyProbe(controlResult, neuteredResult, throwResult, markerSeen);

    return {
      project,
      file,
      symbol,
      testCommand,
      control: controlResult,
      neutered: neuteredResult,
      throwArm: throwResult,
      markerSeen,
      execution: classification.execution,
      verdict: classification.verdict,
      reason: classification.reason,
    };
  } finally {
    teardown();
  }
}
