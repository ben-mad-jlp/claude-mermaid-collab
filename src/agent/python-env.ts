/**
 * PYTHON WORKTREE RESOLUTION — the second half of venv provisioning.
 *
 * `linkSharedDeps` (worktree-manager) symlinks the main checkout's `.venv` into a leaf/epic
 * worktree so a Python leaf has an interpreter at all. But sharing a venv also shares its
 * EDITABLE-INSTALL PIN, and that pin is an absolute path into the MAIN CHECKOUT:
 *
 *   backend/.venv/lib/python3.13/site-packages/__editable__.annotator-0.1.0.pth
 *     → /Users/benmaderazo/Code/yolox-markup/backend/src
 *
 * So `./backend/.venv/bin/python -m pytest` run from a worktree imports the package from the
 * MAIN CHECKOUT and tests code the leaf did not change. Verified live 2026-08-07:
 *
 *   (no PYTHONPATH)                  → /Users/…/yolox-markup/backend/src/annotator   ← main
 *   PYTHONPATH=$PWD/backend/src      → <worktree>/backend/src/annotator              ← correct
 *
 * PYTHONPATH wins because it is processed BEFORE site-packages, where `.pth` entries append.
 *
 * Why this is worse than the bug it replaces: a leaf ADDING a new symbol still fails loudly on
 * import, but a leaf MODIFYING existing behaviour gets a green suite that never exercised its
 * diff — and is accepted. A partial silent failure is harder to notice than a hard one.
 *
 * Fixed at the ENV, not in the prompt (`worktreeSpawnEnv`, node-invoker) — the same place
 * GIT_DIR/GIT_WORK_TREE are stripped so an inherited env cannot point a child at the wrong
 * tree. An editable `.pth` aimed at the main checkout is that same bug via another mechanism,
 * and env-level beats prompt-level because it does not depend on the leaf complying.
 *
 * `node_modules` has no equivalent problem: Node resolves upward from cwd, so a worktree's own
 * sources always win. This is Python-specific and deliberately not generalised.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

/** What marks a directory as a Python project. SINGLE SOURCE OF TRUTH — `SHARED_DEP_ECOSYSTEMS`
 *  in worktree-manager imports this rather than repeating the list, so "where do we link a venv"
 *  and "what goes on PYTHONPATH" can never drift apart. */
export const PYTHON_PROJECT_MARKERS = [
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'setup.cfg',
  'Pipfile',
] as const;

/** Dirs skipped by the walk — build output and dependency trees, never project sources.
 *  Mirrors the WorktreeManager walk so both see the same shape of repo. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'out']);

const MAX_DEPTH = 3;

/** Bounded, synchronous walk returning worktree-relative dirs containing any Python marker.
 *  Sync because `worktreeSpawnEnv` is sync and runs once per node spawn. */
export function findPythonProjectDirs(root: string): string[] {
  const out: string[] = [];
  const want = new Set<string>(PYTHON_PROJECT_MARKERS);
  const walk = (relDir: string, depth: number): void => {
    const abs = path.join(root, relDir);
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(abs, { withFileTypes: true } as any) as any;
    } catch {
      return;
    }
    if ((entries as any[]).some((e: any) => e.isFile() && want.has(e.name))) out.push(relDir);
    if (depth <= 0) return;
    for (const e of entries as any[]) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) {
        walk(path.join(relDir, e.name), depth - 1);
      }
    }
  };
  walk('', MAX_DEPTH);
  return out;
}

/** The ABSOLUTE source dirs of `worktreeRoot` that must precede the shared venv's site-packages.
 *  For each Python project dir: `<dir>/src` when it exists (src-layout — the yolox-markup case),
 *  else `<dir>` itself (flat layout). Deduped, order-stable. */
export function pythonSourceDirs(worktreeRoot: string): string[] {
  const out: string[] = [];
  for (const rel of findPythonProjectDirs(worktreeRoot)) {
    const base = path.join(worktreeRoot, rel);
    const src = path.join(base, 'src');
    let chosen = base;
    try {
      if (existsSync(src) && statSync(src).isDirectory()) chosen = src;
    } catch {
      /* fall back to the project dir */
    }
    if (!out.includes(chosen)) out.push(chosen);
  }
  return out;
}

/**
 * The PYTHONPATH a node spawned at `worktreeRoot` should get, or `undefined` when the repo has
 * no Python project dirs — so a non-Python repo NEVER receives an empty or ":"-only value.
 * An inherited PYTHONPATH is PRESERVED, appended after ours (ours must win; theirs must survive).
 */
export function pythonPathFor(worktreeRoot: string, inherited?: string): string | undefined {
  const dirs = pythonSourceDirs(worktreeRoot);
  if (dirs.length === 0) return undefined;
  const tail = (inherited ?? '')
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !dirs.includes(p));
  return [...dirs, ...tail].join(path.delimiter);
}
