// MITIGATION for the leaf-executor worktree write-leak.
//
// A leaf node spawns the Claude CLI with cwd = the leaf worktree, but the CLI's
// project-root detection resolves to the MAIN checkout, not the worktree: a git
// worktree's `.git` is a gitlink FILE, and `git rev-parse --git-common-dir` points
// back to `<main-repo>/.git`. So a new-file write the implement node makes can land
// in the MAIN checkout root instead of the worktree. The review node then runs
// `git status` IN THE WORKTREE, the file is absent → FAIL → retry → thrash (burning
// nodes/cost), and stray files pile up in the driving project's root.
//
// This sweep is mechanism-agnostic: snapshot the main checkout's dirty set BEFORE the
// writing nodes, then — before the review node — MOVE any file that appeared/changed
// during the run into the worktree at the same relative path, restoring the main
// checkout. Best-effort and deterministic; it never throws into the run.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface RootSnapshot {
  /** The MAIN checkout root (<repo>) the worktree belongs to, or null if undetectable. */
  root: string | null;
  /** porcelain path → 2-char status, captured before the writing nodes. */
  before: Map<string, string>;
}

/** Resolve the MAIN checkout root for a worktree cwd via `--git-common-dir`
 *  (`<repo>/.git` → `<repo>`). This is exactly the path the CLI's root detection
 *  leaks writes to. Returns null when cwd is not inside a git worktree. */
export function mainCheckoutRoot(worktreeCwd: string): string | null {
  try {
    const common = execFileSync('git', ['-C', worktreeCwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!common) return null;
    const abs = resolve(worktreeCwd, common); // common may be relative to cwd
    // `abs` is `<repo>/.git` (a real .git dir in the main worktree). The repo root is its parent.
    return dirname(abs);
  } catch {
    return null;
  }
}

function rootStatus(root: string): Map<string, string> {
  const m = new Map<string, string>();
  try {
    const out = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of out.split('\n')) {
      if (line.length < 4) continue;
      m.set(line.slice(3), line.slice(0, 2));
    }
  } catch { /* best-effort */ }
  return m;
}

/** Snapshot the main checkout's dirty set BEFORE the writing nodes run. */
export function snapshotMainCheckout(worktreeCwd: string): RootSnapshot {
  const root = mainCheckoutRoot(worktreeCwd);
  return { root, before: root ? rootStatus(root) : new Map() };
}

/** Move files that LEAKED into the main checkout during the run (present/changed now,
 *  absent/unchanged in the snapshot) into the worktree at the same relative path, and
 *  restore the main checkout. Returns the relative paths swept. Never throws. */
export function sweepLeakedWrites(worktreeCwd: string, snap: RootSnapshot): string[] {
  const root = snap.root;
  if (!root || resolve(root) === resolve(worktreeCwd)) return []; // no worktree → nothing to sweep
  const swept: string[] = [];
  const after = rootStatus(root);
  for (const [path, status] of after) {
    if (snap.before.get(path) === status) continue; // unchanged since the snapshot → not this run's leak
    const untracked = status.startsWith('??');
    const src = join(root, path);
    if (!existsSync(src)) continue;
    const dest = join(worktreeCwd, path);
    try {
      mkdirSync(dirname(dest), { recursive: true });
      try {
        renameSync(src, dest); // same-filesystem move (worktree lives under the repo)
      } catch {
        // cross-device fallback: copy then remove the source
        writeFileSync(dest, readFileSync(src));
        if (untracked) rmSync(src, { force: true });
      }
      if (!untracked) {
        // a TRACKED file was modified in the root → restore the root's committed version
        try { execFileSync('git', ['-C', root, 'checkout', 'HEAD', '--', path], { stdio: 'ignore' }); } catch { /* best-effort */ }
      }
      swept.push(path);
    } catch {
      // give up on this one path; never break the run
    }
  }
  return swept;
}
