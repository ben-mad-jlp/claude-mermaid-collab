/** Shared base-attribution classifier and leaf own-change-set resolver.
 *
 * A pure primitive: given a leaf's own change-set and a gate's failure output, classify
 * whether the failure belongs to the leaf's own work, to the epic base (foreign
 * contamination), or is unattributable (unparseable output / no change-set to judge
 * against). Not wired into any live gate/leaf-executor call site — a producer leaf (writes
 * `baseAttributed`) and a consumer leaf (reads it) build on this separately.
 */
import type { GitRunner } from './main-checkout-invariant';
import { extractDiagnosticFiles, extractFailingTests, isInChangeSet, parseChangedFiles } from './gate-runner';

/** Resolve the change-set THIS leaf itself authored, unioning two sources:
 *  1. Every commit on the epic branch (not reachable from base) carrying this leaf's
 *     `Collab-Todo: <leafId>` trailer, diffed for its touched files.
 *  2. The lane worktree's own uncommitted + committed-since-branch diff (`fetchLaneChangeSet`
 *     shape from gate-runner.ts).
 *  Returns null (never `[]`) when every git read attempted failed — fail-closed, same
 *  contract as `fetchLaneChangeSet`. */
export async function resolveLeafOwnChangeSet(input: {
  cwd: string;
  epicBranch: string;
  baseBranch: string;
  leafId: string;
  runGit: GitRunner;
}): Promise<string[] | null> {
  const { cwd, epicBranch, baseBranch, leafId, runGit } = input;
  const set = new Set<string>();
  let read = false;

  // 1. Commit-trailer half: ALL matching shas on the epic branch, not just the first.
  if (epicBranch !== baseBranch) {
    try {
      const logRes = await runGit(cwd, [
        'log', '--format=%H', '--fixed-strings',
        `--grep=Collab-Todo: ${leafId}`,
        `${baseBranch}..refs/heads/${epicBranch}`,
      ]);
      if (logRes.code === 0) {
        read = true;
        const shas = logRes.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const sha of shas) {
          try {
            const diffRes = await runGit(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
            if (diffRes.code === 0) {
              for (const line of diffRes.stdout.split('\n')) {
                const p = line.trim();
                if (p) set.add(p);
              }
            }
          } catch { /* one failing diff-tree doesn't abort the union */ }
        }
      }
    } catch { /* one failing log call doesn't abort the union */ }
  }

  // 2. Lane-worktree half: committed diff vs epic branch UNION uncommitted status.
  try {
    const diffRes = await runGit(cwd, ['diff', '--name-only', `${epicBranch}..HEAD`]);
    if (diffRes.code === 0) {
      read = true;
      for (const line of diffRes.stdout.split('\n')) {
        const p = line.trim();
        if (p) set.add(p);
      }
    }
  } catch { /* fall through to the status half */ }
  try {
    const statusRes = await runGit(cwd, ['status', '--porcelain']);
    if (statusRes.code === 0) {
      read = true;
      for (const p of parseChangedFiles(statusRes.stdout)) set.add(p);
    }
  } catch { /* one failing call doesn't abort the union */ }

  return read ? [...set] : null;
}

/** An order-independent dedup key for a gate failure: identical `failingFiles` in a
 *  different order produce an identical string. */
export function gateFailureSignature(command: string, failingFiles: readonly string[]): string {
  const deduped = [...new Set(failingFiles.map((f) => f.trim()).filter(Boolean))].sort();
  return `${command}::${deduped.join('|')}`;
}

export interface GateFailureClassification {
  kind: 'own' | 'epic-base-red' | 'unattributable';
  failingFiles: string[];
  signature: string;
}

/** Classify a gate failure against a leaf's own change-set: `own` (at least one failing
 *  file is the leaf's own work), `epic-base-red` (every failing file is foreign), or
 *  `unattributable` (unparseable output, or no change-set to judge against — reject-closed,
 *  matching today's behaviour). */
export function classifyGateFailure(input: {
  command: string;
  output: string;
  ownChangeSet: readonly string[] | null;
}): GateFailureClassification {
  const { command, output, ownChangeSet } = input;
  let failingFiles = extractDiagnosticFiles(output);
  if (failingFiles.length === 0) failingFiles = extractFailingTests(output);
  const signature = gateFailureSignature(command, failingFiles);

  if (failingFiles.length === 0) {
    return { kind: 'unattributable', failingFiles, signature };
  }
  if (!ownChangeSet || ownChangeSet.length === 0) {
    return { kind: 'unattributable', failingFiles, signature };
  }
  const kind = failingFiles.some((f) => isInChangeSet(f, ownChangeSet)) ? 'own' : 'epic-base-red';
  return { kind, failingFiles, signature };
}
