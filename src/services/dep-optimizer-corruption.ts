/**
 * dep-optimizer-corruption.ts — detect vitest/vite dep-optimizer cache corruption.
 *
 * When .vitest/deps or .vite/deps falls out of sync, module resolution fails with
 * ERR_MODULE_NOT_FOUND pointing into the corrupted cache. This is an infra issue
 * (stale cache, need rebuild), not a base defect.
 */

/**
 * Detects if the gate output contains an ERR_MODULE_NOT_FOUND or Cannot find module error
 * that is caused by a stale dep-optimizer cache, not an actual base defect.
 *
 * @param output The full gate output (stdout+stderr)
 * @returns true iff the output contains a module-not-found error on a vitest/vite cache path
 */
export function isDepOptimizerCorruption(output: string): boolean {
  // Pattern for the three known dep-optimizer cache markers
  const depOptimizerCachePattern = /(?:node_modules\/\.vitest\/deps|\.vite\/deps|\.vitest-cache\/deps)/;

  // Split output into blocks (separated by blank lines) to ensure the error
  // and cache marker are in the same error context
  const blocks = output.split(/\n\n+/);

  // Check each block independently
  for (const block of blocks) {
    const hasModuleError =
      /ERR_MODULE_NOT_FOUND|Cannot find module/.test(block);
    const hasCacheMarker = depOptimizerCachePattern.test(block);

    // Both must be present in the same block
    if (hasModuleError && hasCacheMarker) {
      return true;
    }
  }

  return false;
}
