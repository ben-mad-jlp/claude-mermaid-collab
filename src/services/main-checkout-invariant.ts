/** Guard against unintended branch changes to the main checkout.
 *
 * The main checkout (projectRoot) must not have its checked-out branch changed during
 * mutating worktree operations. This module snapshots the branch identity before and after
 * an operation, and throws if they differ unexpectedly.
 */

export type GitRunner = (
  cwd: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface MainCheckoutHead {
  /** git symbolic-ref --short HEAD, trimmed; null when HEAD is detached. */
  branch: string | null;
  /** git rev-parse HEAD, trimmed; '' if unresolved (non-git / no commits). */
  sha: string;
}

export class MainCheckoutBranchChangedError extends Error {
  name = 'MainCheckoutBranchChangedError';

  constructor(
    public readonly projectRoot: string,
    public readonly before: MainCheckoutHead,
    public readonly after: MainCheckoutHead,
  ) {
    const branchMsg = before.branch !== after.branch
      ? `branch changed from ${before.branch ?? 'detached'} to ${after.branch ?? 'detached'}`
      : `detached HEAD changed from ${before.sha} to ${after.sha}`;
    super(`Main checkout invariant violated at ${projectRoot}: ${branchMsg}`);
  }
}

/** Read the current HEAD of the main checkout (branch name and sha).
 *  On any git error, treats branch/sha as null/'' (non-git fallback tolerance,
 *  mirrors isGitRepo/detectBaseBranch at worktree-manager.ts:2337-2352).
 */
export async function readMainCheckoutHead(
  projectRoot: string,
  runGit: GitRunner,
): Promise<MainCheckoutHead> {
  const [branchResult, shaResult] = await Promise.all([
    runGit(projectRoot, ['symbolic-ref', '--short', 'HEAD']),
    runGit(projectRoot, ['rev-parse', 'HEAD']),
  ]);

  const branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;
  const sha = shaResult.code === 0 ? shaResult.stdout.trim() : '';

  return { branch, sha };
}

/** Wrap an async operation with a main-checkout branch identity guard.
 *  Snapshots the branch before, awaits fn(), snapshots after, then compares identity:
 *  - same named branch → OK (even if sha advanced due to reset --hard)
 *  - branch→detached or detached→branch → throw
 *  - detached with sha change → throw
 *  On fn() rejection, propagates unchanged (no invariant check on error path).
 *  On success, throws MainCheckoutBranchChangedError if identity differs,
 *  otherwise returns fn()'s result.
 */
export async function withMainCheckoutInvariant<T>(
  projectRoot: string,
  runGit: GitRunner,
  fn: () => Promise<T>,
): Promise<T> {
  const before = await readMainCheckoutHead(projectRoot, runGit);

  let result: T;
  try {
    result = await fn();
  } catch (err) {
    throw err;
  }

  const after = await readMainCheckoutHead(projectRoot, runGit);

  // Check identity: same named branch (or both detached with same sha) → OK.
  const identityChanged =
    before.branch !== after.branch ||
    (before.branch === null && after.branch === null && before.sha !== after.sha);

  if (identityChanged) {
    throw new MainCheckoutBranchChangedError(projectRoot, before, after);
  }

  return result;
}
