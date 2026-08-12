/**
 * Pure construction of a scoped backend test command from a changed file list.
 * No fs, spawn, git, or other I/O — all logic is deterministic over the input.
 */
import { isQuarantined } from './quarantine';

/**
 * Filter changed files to backend spec files under src/ or desktop/src/,
 * excluding any that are quarantined.
 *
 * Preserves input order, no dedup beyond natural set membership.
 */
export function selectBackendSpecFiles(changedFiles: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const file of changedFiles) {
    if (seen.has(file)) continue;

    // Must be a test file
    if (!/\.test\.tsx?$/.test(file)) continue;

    // Normalize path separators to forward slashes
    const normalized = file.replace(/\\/g, '/');

    // Must be in src/ or desktop/src/
    const inSrc = normalized.includes('/src/') || normalized.startsWith('src/');
    const inDesktopSrc = normalized.includes('/desktop/src/') || normalized.startsWith('desktop/src/');

    if (!inSrc && !inDesktopSrc) continue;

    // Must not be quarantined
    if (isQuarantined(file)) continue;

    result.push(file);
    seen.add(file);
  }

  return result;
}

/**
 * Build a scoped `bun run scripts/test-backend.ts` command for the given changed files,
 * or return null if no backend spec files are found.
 */
export function buildScopedBackendTestCommand(changedFiles: readonly string[]): string | null {
  const files = selectBackendSpecFiles(changedFiles);
  if (files.length === 0) return null;

  return `bun run scripts/test-backend.ts ${files.map(shellQuote).join(' ')}`;
}

/** Single-quote a path for `sh -c`, escaping any embedded single quotes. */
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}
