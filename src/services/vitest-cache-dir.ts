import * as path from 'node:path';

/**
 * Resolve the per-worktree vitest cache directory.
 * Each worktree has its own isolated cache at <repoRoot>/.vitest-cache,
 * preventing cache collisions when multiple worktrees run vitest concurrently.
 *
 * @param repoRoot - The worktree root (parent of ui/), typically from path.resolve(__dirname, '..')
 * @returns Absolute path to the .vitest-cache directory
 */
export function resolveVitestCacheDir(repoRoot: string): string {
  return path.join(repoRoot, '.vitest-cache');
}
