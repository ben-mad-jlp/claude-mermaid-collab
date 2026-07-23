/**
 * Worktree-scoped bash execution — the execute body behind the run_bash tools.
 *
 * Two guards: (1) reject an absolute `cd` out of the lane worktree (the cwd is
 * threaded, never process.chdir); (2) for a read-only phase, a CONSERVATIVE
 * best-effort block of obvious tree-mutating commands. NOTE: regex blocking is NOT
 * a real read-only guarantee — a determined command can evade it. True read-only
 * isolation is the OS sandbox (batteries Tier-3, deferred). The real safety today
 * is the capability layer: read-only phases only get run_bash_ro, and the worktree
 * is disposable.
 */
import { spawn } from 'node:child_process';

export const BASH_OUTPUT_CAP = 30_000;

/** Absolute `cd` (cd /…) anywhere in the command — would escape the worktree. */
const ABS_CD = /(^|&&|;|\|)\s*cd\s+\//;

/** Obvious tree/state mutators — blocked under read-only (best-effort). Redirects
 *  (`>`) are intentionally NOT regex-blocked (too leaky vs `2>&1`); rely on the
 *  capability layer + disposable worktree instead. */
const MUTATING =
  /\b(rm|mv|cp|sed\s+-i|tee|truncate|chmod|chown)\b|\bgit\s+(commit|add|push|reset|checkout|merge|rebase|restore|stash)\b/;

export interface BashResult {
  exit: number;
  output: string;
}

/** Run `cmd` in `cwd` ASYNC. Returns {exit, output} (output tail-capped), or {error}
 *  when a guard rejects the command before execution. NEVER a sync spawn: worker-core
 *  lanes run IN the sidecar process (§6.7 in-process harnesses), and a sync bash
 *  (tests can take minutes) starves its event loop past the Electron liveness
 *  watchdog (crit-6, mission 693bbc27). */
export async function bashOp(cwd: string, cmd: string, opts: { readOnly?: boolean } = {}): Promise<BashResult | { error: string }> {
  if (ABS_CD.test(cmd)) {
    return { error: 'do not cd to absolute paths — you are already in your worktree; use relative paths' };
  }
  if (opts.readOnly && MUTATING.test(cmd)) {
    return { error: `run_bash_ro: command appears to mutate state, blocked in a read-only phase: ${cmd}` };
  }
  return await new Promise<BashResult>((resolvePromise) => {
    try {
      const child = spawn('bash', ['-lc', cmd], { cwd });
      let out = '';
      child.stdout?.on('data', (d: Buffer) => { out = (out + d.toString()).slice(-BASH_OUTPUT_CAP * 2); });
      child.stderr?.on('data', (d: Buffer) => { out = (out + d.toString()).slice(-BASH_OUTPUT_CAP * 2); });
      child.on('error', () => resolvePromise({ exit: -1, output: out.slice(-BASH_OUTPUT_CAP) }));
      child.on('close', (code) => resolvePromise({ exit: code ?? -1, output: out.slice(-BASH_OUTPUT_CAP) }));
    } catch {
      resolvePromise({ exit: -1, output: '' });
    }
  });
}
