/**
 * nested-runner-lane.ts — classification of test files that spawn nested test runners.
 *
 * WHY THIS EXISTS. Backend test suites run with per-file isolation (one process per file)
 * because they share on-disk state (SQLite DBs, temp dirs at fixed paths). A test file that
 * itself spawns a SECOND `bun test` run (mutation-check.test.ts's mutation-probing) cannot
 * coexist in the fast lane alongside the parent isolation pool — a nested runner means "run
 * me serially, not in parallel with my siblings", because my test harness is ALREADY managing
 * concurrency and state.
 *
 * CONVENTION: a test file marks itself with the `@nested-test-runner` pragma in a leading
 * comment if it spawns a nested runner, or `@nested-test-runner: inert` if it CONTAINS the
 * strings (e.g., as fixture data or doc examples) but never EXECUTES them.
 *
 * Excluded in ONE place by the backend regression floor:
 *   1. `scripts/test-backend.ts:collectBackendTestFiles` — partitions test files into fast
 *      (bounded-concurrency pool) and nested (sequential) lanes, skipping the fast-lane batch
 *      when a per-project gate command specifies `--lane=fast` (preventing parallel state
 *      collision).
 *
 * Consumed by: `scripts/test-backend.ts:collectBackendTestFiles` (the admission guard for the
 * backend regression floor). A future nested-runner file walker must import and call its
 * function so partition site is visible drift, not a silent miss.
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

/**
 * Strip line comments (double slash) and block comments (slash star ... star slash) from source code.
 * Used only by detectNestedRunnerSpawn, never by isNestedRunnerSource (which reads pragmas
 * deliberately from the raw, uncommented source).
 */
function stripComments(source: string): string {
  let result = '';
  let inBlockComment = false;
  let i = 0;

  while (i < source.length) {
    // Check for block comment start
    if (!inBlockComment && source[i] === '/' && source[i + 1] === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    // Check for block comment end
    if (inBlockComment && source[i] === '*' && source[i + 1] === '/') {
      inBlockComment = false;
      i += 2;
      continue;
    }

    // Check for line comment
    if (!inBlockComment && source[i] === '/' && source[i + 1] === '/') {
      // Skip to end of line
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    // Add character if not in block comment
    if (!inBlockComment) {
      result += source[i];
    }

    i++;
  }

  return result;
}

/**
 * Detect if source (with comments stripped) contains evidence of spawning a nested test runner.
 * Returns true if source contains:
 *   (i)   a contiguous substring like `bun test`, `bunx vitest`, or `npm run test`
 *   (ii)  argv-shaped adjacencies: quoted strings matching patterns like
 *         'bun','test' or 'bunx','vitest' or 'npm','run','test' (whitespace-tolerant)
 */
export function detectNestedRunnerSpawn(source: string): boolean {
  const stripped = stripComments(source);

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
 * Classify whether a test file should run in the nested (serial) lane.
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
 * Partition a list of files into fast (bounded concurrency) and nested (serial) lanes
 * based on their source content.
 */
export function partitionNestedRunners<T extends string>(
  files: readonly T[],
  readSource: (f: T) => string,
): { fast: T[]; nested: T[] } {
  const fast: T[] = [];
  const nested: T[] = [];

  for (const file of files) {
    const source = readSource(file);
    if (isNestedRunnerSource(source)) {
      nested.push(file);
    } else {
      fast.push(file);
    }
  }

  return { fast, nested };
}
