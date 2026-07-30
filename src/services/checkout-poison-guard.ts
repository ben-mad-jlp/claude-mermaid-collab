/** Detect and restore a poisoned checkout (working-tree modifications/deletions/renames
 *  relative to HEAD) using porcelain status parsing, mirroring the fail-open tolerance of
 *  readMainCheckoutHead (main-checkout-invariant.ts:59-76).
 */

export type { GitRunner } from './main-checkout-invariant';
import type { GitRunner } from './main-checkout-invariant';

export function parsePoisonedStatus(porcelain: string): { paths: string[]; kinds: string[] } {
  const lines = porcelain.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
  const paths: string[] = [];
  const kinds: string[] = [];

  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    const remainder = line.slice(3);

    let kind: string | null = null;
    if (x === 'M' || y === 'M') kind = 'modified';
    else if (x === 'D' || y === 'D') kind = 'deleted';
    else if (x === 'R' || x === 'C') kind = 'renamed';

    if (!kind) continue;

    const arrowIdx = remainder.indexOf(' -> ');
    const path = arrowIdx >= 0 ? remainder.slice(arrowIdx + 4) : remainder;

    paths.push(path);
    kinds.push(kind);
  }

  return { paths, kinds };
}

export interface PoisonedCheckout {
  poisoned: boolean;
  paths: string[];
  detail: string[];
}

export async function detectPoisonedCheckout(cwd: string, runGit: GitRunner): Promise<PoisonedCheckout> {
  const result = await runGit(cwd, ['status', '--porcelain', '--untracked-files=no']);

  if (result.code !== 0) {
    return { poisoned: false, paths: [], detail: ['probe-failed'] };
  }

  const { paths, kinds } = parsePoisonedStatus(result.stdout);
  return { poisoned: paths.length > 0, paths, detail: kinds };
}

export async function restorePathsToHead(
  cwd: string,
  paths: string[],
  runGit: GitRunner,
): Promise<{ restored: string[]; failed: string[] }> {
  if (paths.length === 0) {
    return { restored: [], failed: [] };
  }

  const resetResult = await runGit(cwd, ['reset', '-q', 'HEAD', '--', ...paths]);
  const checkoutResult = await runGit(cwd, ['checkout', '-f', 'HEAD', '--', ...paths]);

  if (resetResult.code !== 0 || checkoutResult.code !== 0) {
    return { restored: [], failed: [...paths] };
  }

  return { restored: [...paths], failed: [] };
}
