/**
 * Shared trunk-ref resolver: origin/HEAD → main → master → literal 'master'.
 *
 * WHY (incident 2026-08-04, mission db089158): the epic dry-merge trial ran
 * `git worktree add --detach <trial> master`. qbs has NO `master` — its trunk is `main` —
 * so worktree-add failed, the trial returned `{ clean: false }`, and every epic was blocked
 * by a `merge-conflict` verdict. `git merge-tree main <epic>` was CLEAN for both epics the
 * whole time. A conflict verdict with no conflicting hunks is a base-ref fault, not a code
 * fault; consulting origin/HEAD first (it names the real default branch even in a repo
 * carrying both `main` and `master`) makes the probe agree with reality.
 *
 * Hermetic: only node: builtins and Bun globals. No relative import of any other `src/`
 * module —
 * `epic-branch-status.ts`, `invariant-check.ts`, and `epic-landed-stamp-gate.ts` all sit
 * above this module in the import graph, and a heavy edge here previously caused a
 * module-init TDZ cycle.
 */

export type GitRunner = (cwd: string, args: string[]) => Promise<{ code: number; stdout: string }>;

/** Hard cap on any single git probe, mirroring epic-branch-status.ts's GIT_PROBE_TIMEOUT_MS. */
const GIT_PROBE_TIMEOUT_MS = 15_000;

/** Run git in `cwd` ASYNC, returning { code, stdout }. Never throws; never hangs (timeout
 *  kill). Async spawn (Bun.spawn + await exited) — never spawnSync. */
export const defaultGitRunner: GitRunner = async (cwd, args) => {
  try {
    const p = Bun.spawn(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'ignore' });
    const killTimer = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } }, GIT_PROBE_TIMEOUT_MS);
    try {
      const [stdout, code] = await Promise.all([
        p.stdout ? new Response(p.stdout).text() : Promise.resolve(''),
        p.exited,
      ]);
      return { code: code ?? 1, stdout };
    } finally {
      clearTimeout(killTimer);
    }
  } catch {
    return { code: 1, stdout: '' };
  }
};

/** Probe `origin/HEAD` and return its short name (stripped of the `origin/` prefix) only
 *  when that ref also resolves via `rev-parse --verify --quiet` — else null. Never throws. */
export async function resolveOriginHeadRef(cwd: string, runGit: GitRunner = defaultGitRunner): Promise<string | null> {
  try {
    const sym = await runGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    if (sym.code !== 0) return null;
    const short = sym.stdout.trim().replace(/^origin\//, '');
    if (!short) return null;
    const ok = await runGit(cwd, ['rev-parse', '--verify', '--quiet', short]);
    return ok.code === 0 ? short : null;
  } catch {
    return null;
  }
}

/** Canonical trunk resolver: origin/HEAD → main → master → literal 'master'. Never throws. */
export async function resolveTrunkRef(cwd: string, runGit: GitRunner = defaultGitRunner): Promise<string> {
  try {
    const originHead = await resolveOriginHeadRef(cwd, runGit);
    if (originHead) return originHead;
    for (const cand of ['main', 'master']) {
      const r = await runGit(cwd, ['rev-parse', '--verify', '--quiet', cand]);
      if (r.code === 0) return cand;
    }
    return 'master';
  } catch {
    return 'master';
  }
}
