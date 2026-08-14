/**
 * tsc-memo.ts — ONE durable tree-keyed typecheck verdict, consulted by every runner.
 *
 * A clean land used to run the whole-tree typecheck up to FOUR times: the base gate's
 * `cfg.typecheck` lane (leaf-gate.ts), the land gate's declared typecheck stage plus the
 * land-typecheck-floor (epic-land-gate.ts / land-typecheck-floor.ts), steward-proof's
 * `tscClean`, and the desktop/ tsc preamble inside every scripts/test-backend.ts child.
 * Only steward's was memoized — an in-process Map keyed `${cwd}:${HEAD}`, underivable by
 * the other runners and lost on restart. This module gives all four the SAME durable
 * verdict, stored in the worker ledger (`tsc_verdict`), so a green from one runner
 * answers the others — including across processes (test-backend is a CHILD of the gates
 * and resolves the same ledger via the MERMAID_SUPERVISOR_DIR discipline).
 *
 * KEY = hash(command, treeSha, cwdKind):
 *  - treeSha is the TREE object (`git rev-parse HEAD^{tree}`), NOT the commit sha. tsc
 *    reads files, not history: an empty tip-bump commit or a merge commit with an
 *    identical tree produces the identical typecheck, and two worktrees checked out at
 *    the same tree share one verdict. Keying on the commit sha would miss on all of
 *    those (the audit's tree-hash-not-commit-sha point).
 *  - cwdKind is the measuring cwd RELATIVE to the repo toplevel ('' = root, 'desktop').
 *    The same command run from a different subdir reads a different tsconfig, so it is
 *    part of the identity; repo-relative (not absolute) so worktrees still share.
 *  - Only CLEAN worktrees (porcelain empty) consult or store — a dirty tree changes tsc
 *    input without moving any sha, so it has no citable identity (the same discipline
 *    the old steward memo enforced). Dirty ⇒ just run, uncached.
 *
 * Serve policy: a PASS is reusable indefinitely for its tree (the tree cannot change
 * under the key). A FAIL is reusable only for TSC_FAIL_TTL_MS (10 min — same spirit as
 * the fail budgets elsewhere: a red must periodically re-earn itself), and is served
 * WITH the capped tail of its original output so it still explains itself.
 *
 * FAIL-OPEN: any git or ledger error just runs the check — the memo is plumbing, and
 * plumbing must never block a gate. A runner result with ran:false (spawn failure,
 * missing compiler) is an incident, not a tree fact, and is never recorded. Similarly,
 * a fail whose diagnostics are exclusively dependency-resolution/cascade codes
 * (TS2307/TS7016/TS2503/TS7006) is a fact about a missing node_modules, not about the
 * tree, and is never recorded — serving such a red would poison steward-proof, the land
 * gate, land-typecheck-floor, and scripts/test-backend.ts for TSC_FAIL_TTL_MS.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { getTscVerdict, recordTscVerdict } from './worker-ledger';
import { classifyTscOutput } from './tsc-infra-degraded';

/** How long a stored FAIL may be served before it must be re-measured. */
export const TSC_FAIL_TTL_MS = 10 * 60 * 1000;

/** Cap on the stored output tail — enough to name every error, never a blob. */
export const TSC_OUTPUT_TAIL_CHARS = 8000;

/** Same shape as leaf-gate's GateSpawn result (structural, no import — leaf-gate imports us).
 *  `code` is optional to stay assignable FROM GateSpawn; absent reads as 0 (GateSpawn's own
 *  convention: callers test `r.code !== 0`). */
export interface TscRunResult {
  ran: boolean;
  code?: number;
  output: string;
}

export type TscRunner = (cwd: string, command: string) => TscRunResult | Promise<TscRunResult>;

/** Injectable git: run `git -C cwd <args>`, resolve {code, stdout}. Never rejects in the
 *  default implementation — a spawn failure resolves code 1 (⇒ fail-open, run uncached). */
export type TscGit = (cwd: string, args: string[]) => { code: number; stdout: string } | Promise<{ code: number; stdout: string }>;

const defaultGit: TscGit = (cwd, args) =>
  new Promise((resolvePromise) => {
    try {
      execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) resolvePromise({ code: typeof (err as { code?: unknown }).code === 'number' ? ((err as { code?: number }).code as number) : 1, stdout: stdout ?? '' });
        else resolvePromise({ code: 0, stdout: stdout ?? '' });
      });
    } catch {
      resolvePromise({ code: 1, stdout: '' });
    }
  });

/** Fallback runner: plain `sh -c` (no niceness/semaphore — production call sites pass their
 *  own gate spawn; this exists so the function is total). */
const defaultRunner: TscRunner = (cwd, command) =>
  new Promise((resolvePromise) => {
    try {
      execFile('sh', ['-c', command], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code?: number }).code as number) : 1) : 0;
        resolvePromise({ ran: true, code, output: `${stdout ?? ''}${stderr ?? ''}` });
      });
    } catch (e) {
      resolvePromise({ ran: false, code: -1, output: e instanceof Error ? e.message : String(e) });
    }
  });

/** realpath that falls back to the input (fake-git tests use paths that don't exist). */
function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export interface MemoizedTscResult extends TscRunResult {
  /** 'memo' = served from the durable verdict without spawning; 'run' = actually measured. */
  source: 'memo' | 'run';
}

/** Resolve the durable identity of a typecheck: '' parts ⇒ no citable identity (dirty tree,
 *  not a repo, git failed) and the check must run uncached. Exported for tests. */
export async function resolveTscKey(
  cwd: string,
  command: string,
  git: TscGit = defaultGit,
): Promise<{ key: string; treeSha: string; cwdKind: string }> {
  const none = { key: '', treeSha: '', cwdKind: '' };
  try {
    const porcelain = await git(cwd, ['status', '--porcelain']);
    if (porcelain.code !== 0) return none; // not a repo / git failed → run uncached
    if (porcelain.stdout.trim()) return none; // dirty → no citable tree sha
    const treeR = await git(cwd, ['rev-parse', 'HEAD^{tree}']);
    const treeSha = treeR.code === 0 ? treeR.stdout.trim() : '';
    if (!treeSha) return none;
    const topR = await git(cwd, ['rev-parse', '--show-toplevel']);
    const top = topR.code === 0 ? topR.stdout.trim() : '';
    if (!top) return none;
    // realpath BOTH sides: `--show-toplevel` answers with symlinks resolved (macOS tmpdir is
    // /var → /private/var), so a raw-path cwd would falsely "escape" its own toplevel.
    const abs = realpathSafe(isAbsolute(cwd) ? resolve(cwd) : resolve(join(process.cwd(), cwd)));
    const cwdKind = relative(realpathSafe(resolve(top)), abs);
    if (cwdKind.startsWith('..')) return none; // cwd escaped its own toplevel?! — no identity
    const key = createHash('sha256').update(`${command}\0${treeSha}\0${cwdKind}`).digest('hex');
    return { key, treeSha, cwdKind };
  } catch {
    return none; // fail-open: memo plumbing must never block a gate
  }
}

/**
 * Run `command` in `cwd` through the durable tree-keyed verdict layer.
 *
 * Clean tree + stored PASS for the same (command, tree, cwdKind) ⇒ served with zero
 * spawns. Stored FAIL younger than TSC_FAIL_TTL_MS ⇒ served with its recorded output
 * tail and exit code. Anything else ⇒ the injectable runner measures for real, and a
 * ran outcome is recorded (best-effort) for every other runner to consult.
 */
export async function memoizedTsc(
  cwd: string,
  command: string,
  opts: { runner?: TscRunner; git?: TscGit; now?: () => number } = {},
): Promise<MemoizedTscResult> {
  const runner = opts.runner ?? defaultRunner;
  const now = opts.now ?? Date.now;
  const { key, treeSha, cwdKind } = await resolveTscKey(cwd, command, opts.git);

  if (key) {
    try {
      const row = getTscVerdict(key);
      if (row) {
        if (row.status === 'pass') {
          return { ran: true, code: 0, output: '', source: 'memo' };
        }
        if (row.status === 'fail' && now() - row.measuredAt < TSC_FAIL_TTL_MS) {
          return { ran: true, code: row.exitCode ?? 1, output: row.output ?? '', source: 'memo' };
        }
      }
    } catch {
      /* fail-open: consult error ⇒ just run */
    }
  }

  const r = await runner(cwd, command);
  const infraDegradedFail = (r.code ?? 0) !== 0 && classifyTscOutput(r.output) === 'infra-degraded';
  if (key && r.ran && !infraDegradedFail) {
    try {
      recordTscVerdict(
        {
          key,
          cwdKind,
          treeSha,
          command,
          status: (r.code ?? 0) === 0 ? 'pass' : 'fail',
          exitCode: r.code ?? 0,
          // Tail, not head: tsc's error summary and last errors live at the end, and a
          // served FAIL must still explain itself (semantics guard).
          output: (r.code ?? 0) === 0 ? null : r.output.slice(-TSC_OUTPUT_TAIL_CHARS),
        },
        now(),
      );
    } catch {
      /* best-effort: a failed record costs a re-measure later, never a wrong verdict */
    }
  }
  return { ...r, source: 'run' };
}
