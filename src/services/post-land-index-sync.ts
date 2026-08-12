/**
 * Post-land narrow index sync: bring already-landed paths (those present in masterSha)
 * from the pre-land base into the main checkout, excluding pre-existing dirty entries.
 *
 * This module exists because an unrelated pre-existing staged/dirty entry must NEVER be
 * destroyed (locked in by land-staged-deletion-residue.test.ts Scenario A/B), while the
 * land itself must contribute no residue of its own — these are compatible because the
 * sync is scoped to `(landedPaths ∩ present-in-masterSha) MINUS realDirty`, leaving every
 * residue path untouched and still raising MainCheckoutResidueError so the operation stays
 * loud. Note the scope decision: only paths added/modified between the shas (--diff-filter=d)
 * are synced, because index-missing-what-HEAD-has is the sole source of a staged deletion;
 * paths the land removed surface as harmless staged adds and are left alone rather than
 * risking `rm --cached` over user content.
 */

import { spawn } from 'node:child_process';

const CHUNK_SIZE = 500;

/**
 * Compute the set of landed paths (those added/modified between oldBaseSha and masterSha)
 * that are not in the residue list, then git-checkout those paths to masterSha content.
 *
 * Returns the paths successfully synced and the residue subset preserved.
 * On git diff/checkout failure, degrades gracefully (fail-closed: empty synced list,
 * error still thrown by caller).
 */
export async function narrowSyncLandedPaths(
  repoRoot: string,
  opts: {
    oldBaseSha: string;
    masterSha: string;
    residuePaths: string[];
  },
): Promise<{ syncedPaths: string[]; preservedPaths: string[] }> {
  const { oldBaseSha, masterSha, residuePaths } = opts;
  const residueSet = new Set(residuePaths);

  // Run `git diff --name-only --diff-filter=d <oldBaseSha>..<trunkSha>` to list added/modified
  // paths (exclude deletions per --diff-filter=d).
  const landedPathsResult = await runGitCommand(repoRoot, [
    'diff',
    '--name-only',
    '--diff-filter=d',
    `${oldBaseSha}..${masterSha}`,
  ]);

  if (landedPathsResult.code !== 0) {
    // Treat diff failure as empty list — fail-closed, never crash.
    return { syncedPaths: [], preservedPaths: [] };
  }

  const allLanded = landedPathsResult.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // Partition: residue paths stay, remainder can be synced.
  const syncedPaths: string[] = [];
  const preservedPaths: string[] = [];

  for (const path of allLanded) {
    if (residueSet.has(path)) {
      preservedPaths.push(path);
    } else {
      syncedPaths.push(path);
    }
  }

  // Chunk-checkout the synced paths in groups of CHUNK_SIZE to avoid command-line
  // length issues and match the pattern already used in leaf-commit-scope.ts.
  if (syncedPaths.length > 0) {
    for (let i = 0; i < syncedPaths.length; i += CHUNK_SIZE) {
      const chunk = syncedPaths.slice(i, i + CHUNK_SIZE);
      await runGitCommand(repoRoot, ['checkout', masterSha, '--', ...chunk]);
      // On checkout failure, still return syncedPaths as best-effort; the caller
      // will throw MainCheckoutResidueError regardless of sync success.
    }
  }

  return { syncedPaths, preservedPaths };
}

/**
 * Spawn git and collect stdout/stderr. On error, return non-zero code.
 * Mirrors the pattern used elsewhere in the codebase for spawning git.
 */
async function runGitCommand(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn('git', ['-C', cwd, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    proc.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });

    proc.on('error', () => {
      resolve({ code: 1, stdout, stderr });
    });
  });
}
