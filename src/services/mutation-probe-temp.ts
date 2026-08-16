/**
 * Mutation probe temporary directory management.
 *
 * Provides the constants and paths for mutation probe trial worktrees,
 * allowing the probe-creation and probe-sweep logic to be decoupled from
 * the broader reaper GC logic.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const MUTATION_PROBE_TEMP_PREFIX = 'collab-mutation-probe-';
export const MUTATION_PROBE_TEMP_CONTAINER = 'collab-mutation-probes';

/**
 * Resolves the dedicated container directory for mutation probe trial worktrees.
 * @param root - The root directory (defaults to os.tmpdir())
 * @returns The container directory path: <root>/collab-mutation-probes
 */
export function mutationProbeTempRoot(root: string = tmpdir()): string {
  return join(root, MUTATION_PROBE_TEMP_CONTAINER);
}

/**
 * Returns the set of directories to scan for stray mutation probe temporaries.
 *
 * By default, scans only the dedicated container directory under os.tmpdir().
 * When tmpRoot is explicitly supplied, also includes the bare tmpRoot itself
 * (for backward compatibility with legacy top-level probe temps in test tmpRoots).
 *
 * @param opts - Options for scan scope customization
 * @param opts.tmpRoot - An explicit temp root to include (e.g., in tests)
 * @returns Array of directory paths to scan, in order: container first, then explicit root
 */
export function probeSweepScanRoots(opts?: { tmpRoot?: string }): string[] {
  const roots: string[] = [];

  const containerRoot = mutationProbeTempRoot(opts?.tmpRoot ?? tmpdir());
  roots.push(containerRoot);

  // Legacy top-level temps: included only when an explicit tmpRoot is supplied
  if (opts?.tmpRoot != null) {
    roots.push(opts.tmpRoot);
  }

  return roots;
}
