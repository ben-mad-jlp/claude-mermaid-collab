/**
 * Epic suite verdict: run the project's own suite commands against an epic
 * branch and a detached scratch worktree of base, compare failing test NAMES
 * (not counts), and report whether the branch introduces NET-NEW failures.
 *
 * Pure verdict logic + an injected SuiteRunner seam (so tests stub it) +
 * a DB/git-backed default runner (scratch worktree lifecycle). Read-only: no
 * work-graph mutation, no landing, no pushing.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { loadProjectManifest } from '../config/project-manifest.js';
import { epicBranchName, epicId8 } from './epic-branch-status.js';
import { extractFailingTests } from './gate-runner.js';

/** Result of running ONE suite command on ONE side (base or branch). `ran:false`
 *  is an INCIDENT — the suite could not be executed at all (missing worktree,
 *  spawn failure) — DISTINCT from ran:true with a non-empty `failing`. */
export interface SuiteRunResult {
  ran: boolean;
  failing: string[];   // failing test NAMES (never counts); [] when ran & all green
  error?: string;      // populated iff ran === false — the incident reason
}

/** Injected runner: given the resolved suite command and which side to run it
 *  on, return that side's failing-NAME set. The DEFAULT impl shells out in the
 *  appropriate worktree and parses names; tests stub it with known sets. */
export type SuiteRunner = (
  command: string,
  side: 'base' | 'branch',
  suite: string,
) => Promise<SuiteRunResult>;

/** Per-suite report. `newFailures` = branchFailing \ baseFailing (NAMES).
 *  `subsetHolds` = branchFailing ⊆ baseFailing (⇔ newFailures.length === 0),
 *  BUT only meaningful when both sides ran; an incident forces the suite
 *  non-passing regardless. */
export interface SuiteVerifyReport {
  suite: string;
  command: string;
  ran: boolean;              // false ⇒ incident (a side could not run)
  branchFailing: string[];
  baseFailing: string[];
  newFailures: string[];
  subsetHolds: boolean;
  reason?: string;           // set when !ran (incident) — carries error text
}

export interface VerifyEpicResult {
  project: string;
  epicId: string;
  base: string;
  passed: boolean;           // every suite ran AND every subsetHolds
  suites: SuiteVerifyReport[];
  reason?: string;           // top-level incident (no suite command resolved, etc.)
}

/** Set difference by NAME: names failing on branch that are NOT failing on base.
 *  Order-preserving over branchFailing, deduped. This is the NET-NEW set. */
export function diffNewFailures(branchFailing: readonly string[], baseFailing: readonly string[]): string[] {
  const base = new Set(baseFailing);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of branchFailing) {
    if (base.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Combine one suite's two runs into a report. An incident on EITHER side ⇒
 *  ran:false, subsetHolds:false, reason set (never silently "passing"). */
export function computeSuiteReport(
  suite: string,
  command: string,
  baseRun: SuiteRunResult,
  branchRun: SuiteRunResult,
): SuiteVerifyReport {
  if (!baseRun.ran || !branchRun.ran) {
    const which = !branchRun.ran ? 'branch' : 'base';
    const err = (!branchRun.ran ? branchRun.error : baseRun.error) || 'suite could not run';
    return {
      suite, command, ran: false,
      branchFailing: branchRun.failing ?? [],
      baseFailing: baseRun.failing ?? [],
      newFailures: [],
      subsetHolds: false,
      reason: `${suite}: ${which} suite could not run — ${err}`,
    };
  }
  const newFailures = diffNewFailures(branchRun.failing, baseRun.failing);
  return {
    suite, command, ran: true,
    branchFailing: branchRun.failing,
    baseFailing: baseRun.failing,
    newFailures,
    subsetHolds: newFailures.length === 0,
  };
}

/** Resolve suite commands from the project manifest's gateCommand and
 *  frontendGateCommand fields. Each becomes one { suite, command } entry. */
export function resolveSuiteCommands(project: string): Array<{ suite: string; command: string }> {
  const manifest = loadProjectManifest(project);
  if (!manifest) return [];

  const out: Array<{ suite: string; command: string }> = [];
  const seen = new Set<string>();

  if (manifest.gateCommand?.trim()) {
    const cmd = manifest.gateCommand.trim();
    if (!seen.has(cmd)) {
      out.push({ suite: 'gate', command: cmd });
      seen.add(cmd);
    }
  }

  if (manifest.frontendGateCommand?.trim()) {
    const cmd = manifest.frontendGateCommand.trim();
    if (!seen.has(cmd)) {
      out.push({ suite: 'frontend', command: cmd });
      seen.add(cmd);
    }
  }

  return out;
}

/** Hard cap on any single suite run (same as git probe timeouts elsewhere). */
const SUITE_TIMEOUT_MS = 15_000;

/** ASYNC bounded spawn (Bun.spawn + await exited + kill timer) — NEVER Bun.spawnSync:
 *  verifyEpic runs in the sidecar (MCP verify_epic / supervisor route), and the old
 *  sync worktree-add + suite-run sequence blocked its event loop for up to a minute
 *  (the Electron liveness-watchdog crash-loop class, crit-6 of mission 693bbc27). */
async function runBounded(
  argv: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string; signaled: boolean }> {
  try {
    const proc = Bun.spawn(argv, { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' });
    const killTimer = setTimeout(
      () => { try { proc.kill(); } catch { /* gone */ } },
      opts.timeoutMs ?? SUITE_TIMEOUT_MS,
    );
    try {
      const [stdout, stderr, code] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(''),
        proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(''),
        proc.exited,
      ]);
      return { code, stdout, stderr, signaled: proc.signalCode != null };
    } finally {
      clearTimeout(killTimer);
    }
  } catch (e) {
    return { code: null, stdout: '', stderr: e instanceof Error ? e.message : String(e), signaled: false };
  }
}

/** Default git-backed suite runner: create scratch worktrees, run suites, parse results. */
function makeGitSuiteRunner(project: string, epicId: string, base: string): SuiteRunner {
  return async (command: string, side: 'base' | 'branch', suite: string): Promise<SuiteRunResult> => {
    const branchRef = side === 'branch' ? epicBranchName(epicId) : base;
    const scratchId = side === 'base' ? epicId8(epicId) + '-base' : epicId8(epicId) + '-branch';
    const scratchDir = join(tmpdir(), `mermaid-collab-verify-${scratchId}`);

    try {
      // Clean up any stale worktree first (ignore failure: may not have been a worktree)
      if (existsSync(scratchDir)) {
        await runBounded(['git', '-C', project, 'worktree', 'remove', '--force', scratchDir]);
      }

      // Create detached worktree at the requested ref
      const addRes = await runBounded(['git', '-C', project, 'worktree', 'add', '--detach', scratchDir, branchRef]);
      if (addRes.code !== 0) {
        const err = addRes.stderr || 'git worktree add failed';
        return { ran: false, failing: [], error: err.trim() };
      }

      // Run the suite command
      const proc = await runBounded(['sh', '-c', command], { cwd: scratchDir });
      if (proc.code === null && !proc.signaled) {
        return { ran: false, failing: [], error: `spawn failed: ${proc.stderr}` };
      }

      // Parse failing test names from the output
      const failing = extractFailingTests(proc.stdout + '\n' + proc.stderr);
      return { ran: true, failing };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ran: false, failing: [], error: msg };
    } finally {
      // ALWAYS remove the scratch worktree (best-effort)
      await runBounded(['git', '-C', project, 'worktree', 'remove', '--force', scratchDir]);
    }
  };
}

/** Run suites on both base and branch, compare failing NAMES, return verdict. */
export async function verifyEpic(
  project: string,
  epicId: string,
  opts: { base?: string; runner?: SuiteRunner } = {},
): Promise<VerifyEpicResult> {
  const base = opts.base?.trim() || 'master';
  const suites = resolveSuiteCommands(project);
  if (suites.length === 0) {
    return {
      project, epicId, base, passed: false, suites: [],
      reason: `no suite command resolved from ${project}/.collab/project.json (gateCommand/frontendGateCommand)`,
    };
  }

  const runner = opts.runner ?? makeGitSuiteRunner(project, epicId, base);
  const reports: SuiteVerifyReport[] = [];

  // SERIAL: never concurrent — the UI suite has load races.
  for (const { suite, command } of suites) {
    const baseRun = await runner(command, 'base', suite);
    const branchRun = await runner(command, 'branch', suite);
    reports.push(computeSuiteReport(suite, command, baseRun, branchRun));
  }

  const passed = reports.every((r) => r.ran && r.subsetHolds);
  return { project, epicId, base, passed, suites: reports };
}
