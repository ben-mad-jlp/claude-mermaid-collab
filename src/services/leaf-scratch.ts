import { mkdirSync, rmSync } from 'node:fs';
import { join, basename, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir, userInfo } from 'node:os';

/**
 * Per-user scratch root.
 *
 * A fixed shared name in tmp is squatted by whichever user's server boots first: it is
 * created under that uid, and every other user's server then fails to write into it. The
 * same defect in the MCP-config directory stopped conductor nodes from starting at all on
 * a shared box (2026-08-21). Scoping by uid removes the collision and survives the reboot
 * that wipes tmp and re-runs the race.
 */
export const LEAF_SCRATCH_ROOT = join(
  tmpdir(),
  `mermaid-leaf-scratch-${process.getuid?.() ?? userInfo().username}`,
);

export function leafScratchFor(worktreePath: string): string {
  return join(LEAF_SCRATCH_ROOT, basename(worktreePath));
}

export function allocateLeafScratch(worktreePath: string): string {
  const dir = leafScratchFor(worktreePath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function reapLeafScratch(worktreePath: string): boolean {
  const dir = leafScratchFor(worktreePath);
  const resolvedRoot = resolve(LEAF_SCRATCH_ROOT);
  const rel = relative(resolvedRoot, resolve(dir));
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
