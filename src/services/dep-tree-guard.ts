import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { LeafGateConfig } from './leaf-gate.js';

export interface DepTreeProbe {
  ok: boolean;
  missing: string[];
  detail: string[];
}

/**
 * Derives the required node_modules roots by enumerating the worktree root and
 * each typechecks/suites/floors lane cwd from the gate config.
 *
 * - Resolves each lane cwd exactly as `runBaseGate` does (join(cwd, lane.cwd) or cwd).
 * - Dedupes preserving first-seen order.
 * - Filters to keep only roots containing package.json.
 * - Seeds the set with cwd itself.
 */
export function requiredDepRoots(cwd: string, cfg: LeafGateConfig): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];

  const add = (root: string) => {
    if (!seen.has(root)) {
      seen.add(root);
      roots.push(root);
    }
  };

  // Seed with the worktree root.
  add(cwd);

  // Enumerate typechecks, suites, and floors in that order (same as runBaseGate).
  for (const lane of cfg.typechecks ?? []) {
    const laneCwd = lane.cwd ? join(cwd, lane.cwd) : cwd;
    add(laneCwd);
  }

  for (const lane of cfg.suites ?? []) {
    const laneCwd = lane.cwd ? join(cwd, lane.cwd) : cwd;
    add(laneCwd);
  }

  for (const lane of cfg.floors ?? []) {
    const laneCwd = lane.cwd ? join(cwd, lane.cwd) : cwd;
    add(laneCwd);
  }

  // Filter to keep only roots containing package.json.
  return roots.filter((root) => existsSync(join(root, 'package.json')));
}

/**
 * Probes the node_modules directory in each root to detect missing or inaccessible dependencies.
 *
 * - Uses `stat` (which follows symlinks) to detect dangling symlinks via ENOENT.
 * - ENOENT: marks the root as missing.
 * - Other errors: fail-open, do not mark as missing (only record in detail).
 * - Returns { ok: missing.length === 0, missing, detail }.
 */
export async function probeDepTrees(
  roots: string[],
  statFn: (p: string) => Promise<unknown> = stat,
): Promise<DepTreeProbe> {
  const missing: string[] = [];
  const detail: string[] = [];

  if (roots.length === 0) {
    return { ok: true, missing: [], detail: [] };
  }

  for (const root of roots) {
    const nodeModulesPath = join(root, 'node_modules');
    try {
      await statFn(nodeModulesPath);
      detail.push(`ok:${root}`);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        missing.push(root);
        detail.push(`missing:${root}`);
      } else {
        // Fail open: other errors do not mark as missing, only record in detail.
        detail.push(`probe-failed:${root}`);
      }
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    detail,
  };
}
