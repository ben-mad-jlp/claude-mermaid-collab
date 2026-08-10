import { mkdirSync, rmSync } from 'node:fs';
import { join, basename, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

export const LEAF_SCRATCH_ROOT = join(tmpdir(), 'mermaid-leaf-scratch');

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
