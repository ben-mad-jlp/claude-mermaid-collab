/** Guard against unintended branch changes to the main checkout.
 *
 * The main checkout (projectRoot) must not have its checked-out branch changed during
 * mutating worktree operations. This module snapshots the branch identity before and after
 * an operation, and throws if they differ unexpectedly.
 */

import { quarantineAndRestoreMainCheckout } from './worktree-write-leak';

export type GitRunner = (
  cwd: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface MainCheckoutState {
  /** git symbolic-ref --short HEAD, trimmed; null when HEAD is detached. */
  branch: string | null;
  /** git rev-parse HEAD, trimmed; '' if unresolved (non-git / no commits). */
  sha: string;
  /** git status --porcelain --untracked-files=all, trimmed non-empty lines; [] on probe failure. */
  residue: string[];
}

/** @deprecated use MainCheckoutState */
export type MainCheckoutHead = MainCheckoutState;

export class MainCheckoutBranchChangedError extends Error {
  name = 'MainCheckoutBranchChangedError';

  constructor(
    public readonly projectRoot: string,
    public readonly before: MainCheckoutState,
    public readonly after: MainCheckoutState,
    public readonly opName: string = 'operation',
  ) {
    const branchMsg = before.branch !== after.branch
      ? `branch changed from ${before.branch ?? 'detached'} to ${after.branch ?? 'detached'}`
      : `detached HEAD changed from ${before.sha} to ${after.sha}`;
    super(`Main checkout invariant violated by ${opName} at ${projectRoot}: ${branchMsg}`);
  }
}

export class MainCheckoutResidueError extends Error {
  name = 'MainCheckoutResidueError';

  constructor(
    public readonly projectRoot: string,
    public readonly opName: string,
    public readonly addedResidue: string[],
    public readonly before: MainCheckoutState,
    public readonly after: MainCheckoutState,
    public readonly quarantinePath?: string,
  ) {
    const basePath = `${addedResidue.join(', ')}`;
    const fullMessage = quarantinePath
      ? `Main checkout residue introduced by ${opName} at ${projectRoot}: ${basePath} (leaked content quarantined at ${quarantinePath})`
      : `Main checkout residue introduced by ${opName} at ${projectRoot}: ${basePath}`;
    super(fullMessage);
  }
}

/** The PATH inside a `git status --porcelain` entry: the 2-char status prefix removed, and
 *  a rename's `old -> new` reduced to the destination. Entries are pre-trimmed by
 *  readMainCheckoutHead, so the prefix may already have lost its leading space — handle both
 *  " M path" and "M  path". Quoted paths (core.quotePath) are left as-is; they compare
 *  consistently because both snapshots quote identically. */
export function residuePath(entry: string): string {
  // Trim FIRST: readMainCheckoutHead pre-trims, so the unstaged form arrives as "M path"
  // (leading space already gone) while the staged form keeps its inner gap, "M  path".
  // Anchoring on the raw string would fail to match the untrimmed " M path" and leave the
  // status letter glued to the path.
  const withoutStatus = entry.trim().replace(/^[MADRCU?!]{1,2}\s+/, '').trim();
  const arrow = withoutStatus.lastIndexOf(' -> ');
  return arrow === -1 ? withoutStatus : withoutStatus.slice(arrow + 4).trim();
}

/** Pure matcher for sanctioned residue lines. Parses a porcelain line and checks if the
 *  repo-relative path matches any of the allowed prefixes using segment-boundary matching.
 *  Returns false (fail closed) for empty/invalid lines, lines with no space, or empty allowlist. */
export function isSanctionedResidue(porcelainLine: string, allowedPrefixes: readonly string[]): boolean {
  // Fail closed: empty allowlist means nothing is sanctioned
  if (allowedPrefixes.length === 0) return false;

  // Trim the line and fail closed on empty/whitespace-only
  const trimmed = porcelainLine.trim();
  if (!trimmed) return false;

  // Parse the porcelain line: first space separates status from path
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return false;

  // Extract path (everything after the first space) and strip trailing `/` (git's dir collapse)
  let path = trimmed.slice(spaceIdx + 1);
  if (path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // Check each allowed prefix using segment-boundary matching (not simple startsWith)
  for (const prefix of allowedPrefixes) {
    // Normalize each prefix by stripping trailing `/`
    let normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;

    // Match iff path === prefix OR path.startsWith(prefix + '/')
    if (path === normalizedPrefix || path.startsWith(normalizedPrefix + '/')) {
      return true;
    }
  }

  return false;
}

/** Read the current HEAD of the main checkout (branch name, sha, and porcelain residue).
 *  On any git error, treats branch/sha/residue as null/''/[] (non-git fallback tolerance,
 *  mirrors isGitRepo/detectBaseBranch at worktree-manager.ts:2337-2352).
 */
export async function readMainCheckoutHead(
  projectRoot: string,
  runGit: GitRunner,
): Promise<MainCheckoutState> {
  const [branchResult, shaResult, statusResult] = await Promise.all([
    runGit(projectRoot, ['symbolic-ref', '--short', 'HEAD']),
    runGit(projectRoot, ['rev-parse', 'HEAD']),
    runGit(projectRoot, ['status', '--porcelain', '--untracked-files=all']),
  ]);

  const branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;
  const sha = shaResult.code === 0 ? shaResult.stdout.trim() : '';
  const residue = statusResult.code === 0
    ? statusResult.stdout.split('\n').map(s => s.trim()).filter(Boolean)
    : [];

  return { branch, sha, residue };
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
  opts: {
    opName?: string;
    onViolation?: (err: MainCheckoutResidueError | MainCheckoutBranchChangedError) => void;
    quarantineDir?: string;
    allowedResidue?: string[];
  } = {},
): Promise<T> {
  const opName = opts.opName ?? 'operation';
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
    const err = new MainCheckoutBranchChangedError(projectRoot, before, after, opName);
    try { opts.onViolation?.(err); } catch { /* best-effort: never mask the throw */ }
    throw err;
  }

  // Compare by PATH, not by the whole porcelain line. A porcelain entry carries a 2-char
  // status prefix — " M path" unstaged vs "M  path" staged — so a file that merely moves
  // between staged and unstaged yields a DIFFERENT string for the SAME path and reads as
  // newly-introduced residue.
  //
  // Not hypothetical: land_epic's tree/index restore re-stages what it finds dirty, so every
  // pre-existing dirty file flips " M" -> "M " across the operation. On 2026-08-07 a land
  // that had ALREADY MERGED (master advanced to 7e1ff0cf, the fix present on master, gate
  // verdict PASS) was then reported FAILED — "residue introduced by land_epic" naming four
  // files that were dirty before it started and had been explicitly waved through with
  // allowDirty. The land succeeded and the caller was told it failed, which is the worst
  // possible answer: a retry re-runs an irreversible merge.
  //
  // Path-level comparison keeps the guard's real purpose — catching files the operation
  // genuinely ADDED — while ignoring a staged/unstaged transition on something already dirty.
  const beforeSet = new Set(before.residue.map(residuePath));
  let addedResidue = after.residue.filter(r => !beforeSet.has(residuePath(r)));
  // Filter out sanctioned residue before the throw or quarantine
  addedResidue = addedResidue.filter(r => !isSanctionedResidue(r, opts.allowedResidue ?? []));
  if (addedResidue.length > 0) {
    let quarantinePath: string | undefined;
    if (opts.quarantineDir) {
      try {
        quarantineAndRestoreMainCheckout(projectRoot, addedResidue, opts.quarantineDir);
        quarantinePath = opts.quarantineDir;
      } catch {
        // best-effort: quarantine failure must not mask the residue error
      }
    }
    const err = new MainCheckoutResidueError(projectRoot, opName, addedResidue, before, after, quarantinePath);
    try { opts.onViolation?.(err); } catch { /* best-effort: never mask the throw */ }
    throw err;
  }

  return result;
}
