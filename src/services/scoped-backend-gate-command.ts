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

/**
 * Normalize a bare `bun test` command to the backend wrapper form.
 *
 * A pure, total function that never throws. Returns the command unchanged unless:
 * 1. It does NOT already contain `scripts/test-backend.ts` (idempotence check first)
 * 2. The lane scope (`matchSource`) is a backend scope: ^src/, ^scripts/, or ^desktop/src/
 * 3. The command is a bare `bun test` invocation
 *
 * When all conditions hold, rewrites `bun test <tail>` to `bun run scripts/test-backend.ts <tail>`,
 * preserving {file}/{files} placeholders and all flags verbatim.
 */
export function normalizeBareRunnerCommand(command: string, matchSource: string): string {
  // 1. Idempotence: already in wrapper form ⇒ unchanged
  if (/scripts\/test-backend\.ts/.test(command)) {
    return command;
  }

  // 2. Lane scope must be backend: ^src/, ^scripts/, or ^desktop/src/
  const trimmedSource = matchSource.trim();
  const isBackendScope =
    trimmedSource.startsWith('^src/') ||
    trimmedSource.startsWith('^scripts/') ||
    trimmedSource.startsWith('^desktop/src/');

  if (!isBackendScope) {
    return command;
  }

  // 3. Command must be a bare `bun test` invocation
  const match = /^bun\s+test\b(.*)$/.exec(command);
  if (!match) {
    return command;
  }

  // All conditions met: rewrite to wrapper form, preserving the tail (flags and placeholders)
  const tail = match[1];
  return `bun run scripts/test-backend.ts${tail}`;
}

/** Single-quote a path for `sh -c`, escaping any embedded single quotes. */
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}
