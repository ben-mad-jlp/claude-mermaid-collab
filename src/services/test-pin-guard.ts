/**
 * LeafTier `test-pinned` immutability helpers.
 *
 * Test-pin immutability is enforced in CODE (hash before/after + path predicate),
 * not by spec prose alone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** LeafTier 'test-pinned' CODE-level immutability predicate: which declared-scope paths
 *  are the pinned executable spec (design-grok-worker-discipline §2.3, TestSpecSchema —
 *  "authored as the spec … must NOT weaken"). Pure; exported for test. */
export function isTestPinnedPath(path: string): boolean {
  return /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.[A-Za-z0-9]+$/.test(path);
}

/** sha256 of each file's on-disk content under `cwd`, keyed by its declared (relative)
 *  path. A missing/unreadable file hashes to null — that is a legitimate baseline state
 *  (nothing pinned yet), never a throw. Pure I/O helper; exported for test. */
export function hashPinnedFiles(cwd: string, files: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of files) {
    try {
      out[f] = createHash('sha256').update(readFileSync(join(cwd, f))).digest('hex');
    } catch {
      out[f] = null;
    }
  }
  return out;
}

/** Diff two {@link hashPinnedFiles} snapshots of the SAME key set and return the paths
 *  whose content changed. A file with no baseline hash (didn't exist yet) is never a
 *  violation — only an EXISTING pinned test can be weakened. Pure; exported for test. */
export function testPinViolations(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): string[] {
  const violations: string[] = [];
  for (const [file, beforeHash] of Object.entries(before)) {
    if (beforeHash === null) continue;
    if (after[file] !== beforeHash) violations.push(file);
  }
  return violations;
}
