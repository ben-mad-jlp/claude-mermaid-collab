/**
 * @nested-test-runner: inert - discusses nested runners in prose/docstrings but never executes them
 * @serial-test-lane: inert - discusses git worktree add in prose/docstrings but never executes it
 *
 * nested-runner-lane.ts — classification of test files that spawn nested test runners or serial-lane work.
 *
 * WHY THIS EXISTS. Backend test suites run with per-file isolation (one process per file)
 * because they share on-disk state (SQLite DBs, temp dirs at fixed paths). A test file that
 * itself spawns a SECOND `bun test` run (mutation-check.test.ts's mutation-probing) cannot
 * coexist in the fast lane alongside the parent isolation pool — a nested runner means "run
 * me serially, not in parallel with my siblings", because my test harness is ALREADY managing
 * concurrency and state.
 *
 * A test file that spawns `git worktree add` in actual code (not as fixture data) also needs
 * serial execution to avoid worktree collisions when multiple tests run in parallel. The
 * @serial-test-lane pragma and detectRealGitWorktreeSpawn detector mark these files.
 *
 * PRAGMA PRECEDENCE. When detecting with literals blanked, code-level detection alone yields
 * zero genuine nested-runner hits except src/services/__tests__/leaf-gate.test.ts (a mocked
 * runner). The @nested-test-runner pragma is therefore authoritative — this is why
 * mutation-check.test.ts (spawns bash → mutation-check.sh → bun test) cannot be detected by
 * token scan alone and must carry the pragma. Likewise, serial-lane detection with literals
 * blanked catches genuine git worktree add() calls but requires @serial-test-lane pragma on
 * files that mention it only as fixture/error strings.
 *
 * CONVENTION: a test file marks itself with the `@nested-test-runner` pragma in a leading
 * comment if it spawns a nested runner, or `@nested-test-runner: inert` if it CONTAINS the
 * strings (e.g., as fixture data or doc examples) but never EXECUTES them. Similarly,
 * `@serial-test-lane` marks real git worktree add spawns, and `@serial-test-lane: inert`
 * marks fixture/comment mentions.
 *
 * Excluded in ONE place by the backend regression floor:
 *   1. `scripts/test-backend.ts:collectBackendTestFiles` — partitions test files into fast
 *      (bounded-concurrency pool), serial (single-threaded git-state isolation), and nested
 *      (sequential for nested test runners), skipping based on lane filter.
 *
 * Consumed by: `scripts/test-backend.ts:collectBackendTestFiles` (the admission guard for the
 * backend regression floor). A future file walker must import and call partitionTestLanes so
 * partition logic is visible and drift is detectable.
 */

/** The pragma constant that marks a test file as spawning a nested test runner. */
export const NESTED_RUNNER_TAG = '@nested-test-runner';

/**
 * The pragma prefix that marks a test file as INERT - it contains nested-runner strings only
 * as fixture data (golden output, doc examples, hardcoded command in test data), never executed.
 * Written as `@nested-test-runner: inert - <reason>` by callers; this constant is matched
 * with `.includes()`.
 */
export const NESTED_RUNNER_INERT_TAG = '@nested-test-runner: inert';

/** The pragma constant that marks a test file as spawning git worktree add (serial lane). */
export const SERIAL_LANE_TAG = '@serial-test-lane';

/**
 * The pragma prefix that marks a test file as INERT for serial-lane purposes - it contains
 * git worktree add strings only as fixture/error/doc data, never executed.
 * Written as `@serial-test-lane: inert - <reason>` by callers; this constant is matched
 * with `.includes()`.
 */
export const SERIAL_LANE_INERT_TAG = '@serial-test-lane: inert';

/**
 * Strip line comments, block comments, and blank string/template literal contents from source.
 * Preserves quote chars/backticks and ${...} structure to maintain length/newline count.
 * This ensures detection logic doesn't fire on runner tokens that only appear inside strings.
 * Used by detectNestedRunnerSpawn and detectRealGitWorktreeSpawn, never by pragma-checking
 * functions (which read pragmas deliberately from the raw, uncommented source).
 */
function stripCommentsAndLiterals(source: string): string {
  let result = '';
  let inBlockComment = false;
  let inStringDouble = false;
  let inStringSingle = false;
  let inTemplate = false;
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    // Track block comment start/end
    if (!inStringDouble && !inStringSingle && !inTemplate) {
      if (!inBlockComment && ch === '/' && next === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (inBlockComment && ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }

      // Track line comment
      if (!inBlockComment && ch === '/' && next === '/') {
        while (i < source.length && source[i] !== '\n') i++;
        continue;
      }
    }

    // If in block comment, skip everything
    if (inBlockComment) {
      i++;
      continue;
    }

    // Track string/template literals
    if (!inBlockComment) {
      // Handle escape sequences in strings/templates
      if ((inStringDouble || inStringSingle || inTemplate) && ch === '\\') {
        result += ch; // preserve backslash
        i++;
        if (i < source.length) {
          result += source[i]; // preserve escaped char as-is
          i++;
        }
        continue;
      }

      // Track double-quoted strings
      if (ch === '"' && !inStringSingle && !inTemplate) {
        inStringDouble = !inStringDouble;
        result += '"'; // preserve quote
        i++;
        continue;
      }

      // Track single-quoted strings
      if (ch === "'" && !inStringDouble && !inTemplate) {
        inStringSingle = !inStringSingle;
        result += "'"; // preserve quote
        i++;
        continue;
      }

      // Track template literals
      if (ch === '`' && !inStringDouble && !inStringSingle) {
        inTemplate = !inTemplate;
        result += '`'; // preserve backtick
        i++;
        continue;
      }

      // Inside template literals, preserve ${ but blank the rest
      if (inTemplate && ch === '$' && next === '{') {
        result += '${'; // preserve the placeholder syntax
        i += 2;
        // Skip to matching }
        let braceDepth = 1;
        while (i < source.length && braceDepth > 0) {
          if (source[i] === '{') braceDepth++;
          else if (source[i] === '}') braceDepth--;
          result += source[i];
          i++;
        }
        continue;
      }

      // Inside string/template, blank the content (but preserve structure)
      if (inStringDouble || inStringSingle || inTemplate) {
        // Preserve newlines to keep line numbers consistent
        if (ch === '\n') {
          result += '\n';
        } else if (ch === '\r') {
          result += '\r';
        } else {
          result += ' '; // blank with space
        }
        i++;
        continue;
      }
    }

    // Outside strings/comments, add character as-is
    result += ch;
    i++;
  }

  return result;
}

/**
 * Detect if source (with comments and literals stripped) contains evidence of spawning a nested test runner.
 * Returns true if source contains:
 *   (i)   a contiguous substring like `bun test`, `bunx vitest`, or `npm run test`
 *   (ii)  argv-shaped adjacencies: quoted strings matching patterns like
 *         'bun','test' or 'bunx','vitest' or 'npm','run','test' (whitespace-tolerant)
 */
export function detectNestedRunnerSpawn(source: string): boolean {
  const stripped = stripCommentsAndLiterals(source);

  // Check for contiguous substrings
  if (stripped.includes('bun test') || stripped.includes('bunx vitest') || stripped.includes('npm run test')) {
    return true;
  }

  // Check for argv-shaped adjacencies like 'bun','test' or 'bunx','vitest' or 'npm','run','test'
  // Pattern: 'bun' (any quote) followed by comma/whitespace followed by 'test' (any quote)
  const patterns = [
    /['"]bun['"]\s*,\s*['"]test['"]/,
    /['"]bunx['"]\s*,\s*['"]vitest['"]/,
    /['"]npm['"]\s*,\s*['"]run['"]\s*,\s*['"]test['"]/,
  ];

  return patterns.some((p) => p.test(stripped));
}

/**
 * Classify whether a test file should run in the nested (serial) lane for nested runners.
 * Logic:
 *   1. If source includes NESTED_RUNNER_INERT_TAG -> false (it's just data, not executed)
 *   2. Else if source includes NESTED_RUNNER_TAG -> true (pragma declares it)
 *   3. Else detectNestedRunnerSpawn(source) -> true if code patterns match
 */
export function isNestedRunnerSource(source: string): boolean {
  // Inert check FIRST - NESTED_RUNNER_TAG is a substring of NESTED_RUNNER_INERT_TAG
  if (source.includes(NESTED_RUNNER_INERT_TAG)) {
    return false;
  }
  if (source.includes(NESTED_RUNNER_TAG)) {
    return true;
  }
  return detectNestedRunnerSpawn(source);
}

/**
 * Detect if source (with comments and literals stripped) contains evidence of spawning git worktree add.
 * Returns true if source contains:
 *   (i)   a contiguous substring `git worktree add`
 *   (ii)  argv-shaped adjacencies: 'worktree' and 'add' as adjacent quoted strings,
 *         with allowance for whitespace and commas (e.g., 'worktree', 'add' in an array)
 */
export function detectRealGitWorktreeSpawn(source: string): boolean {
  const stripped = stripCommentsAndLiterals(source);

  // Check for contiguous substring
  if (stripped.includes('git worktree add')) {
    return true;
  }

  // Check for argv-shaped adjacencies like 'worktree','add' or "worktree","add"
  const pattern = /['"]worktree['"]\s*,\s*['"]add['"]/;
  return pattern.test(stripped);
}

/**
 * Classify whether a test file should run in the serial-lane (single-threaded git isolation).
 * Logic:
 *   1. If source includes SERIAL_LANE_INERT_TAG -> false (it's just data, not executed)
 *   2. Else if source includes SERIAL_LANE_TAG -> true (pragma declares it)
 *   3. Else detectRealGitWorktreeSpawn(source) -> true if code patterns match
 */
export function isSerialLaneSource(source: string): boolean {
  // Inert check FIRST - SERIAL_LANE_TAG is a substring of SERIAL_LANE_INERT_TAG
  if (source.includes(SERIAL_LANE_INERT_TAG)) {
    return false;
  }
  if (source.includes(SERIAL_LANE_TAG)) {
    return true;
  }
  return detectRealGitWorktreeSpawn(source);
}

/**
 * Partition a list of files into fast (bounded concurrency), serial (single-threaded git),
 * and nested (serial for nested runners) lanes based on their source content.
 *
 * Precedence: nested wins over serial when both conditions match (nested is checked first).
 * Otherwise, serial if it matches; else fast.
 */
export function partitionTestLanes<T extends string>(
  files: readonly T[],
  readSource: (f: T) => string,
): { fast: T[]; serial: T[]; nested: T[] } {
  const fast: T[] = [];
  const serial: T[] = [];
  const nested: T[] = [];

  for (const file of files) {
    const source = readSource(file);
    // Nested wins on overlap
    if (isNestedRunnerSource(source)) {
      nested.push(file);
    } else if (isSerialLaneSource(source)) {
      serial.push(file);
    } else {
      fast.push(file);
    }
  }

  return { fast, serial, nested };
}
