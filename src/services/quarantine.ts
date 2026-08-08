/**
 * quarantine.ts — the ONE definition of "this test is quarantined".
 *
 * WHY THIS EXISTS. A finding is only durable once its repro is COMMITTED: an un-triaged finding
 * whose repro lives in a bucket row is inert, and a repro that dies with the session is exactly
 * what this system already loses today. But a committed RED test cannot go in the normal suite —
 * one red test reds the base gate for EVERY epic project-wide, which is the worst recurring
 * pathology in this repo. So red-by-design repros need somewhere to live that is durable AND
 * outside the gate.
 *
 * A quarantined test is EXPECTED to be red. It is a recorded, executable defect — not a failure.
 * It leaves quarantine by being PROMOTED into the normal suite when its fix lands, which is also
 * the proof the fix worked.
 *
 * SECOND USE, equally load-bearing: the quarantine suite is the DEDUP INDEX. Before filing a
 * finding, run it — if the observation is already covered by a red quarantined test, this is a
 * recurrence, not a new finding. That replaces hashing prose (claim wording drifts, free-text
 * surfaces drift, flaky repros churn a key) with matching on what a repro DOES. The bugfix bucket
 * currently holds a live duplicate pair filed a day apart precisely because prose was the only
 * comparable thing.
 *
 * CONVENTION: any path with a `__quarantine__` segment. A directory rather than a filename suffix
 * so a whole finding (repro + fixtures + notes) can sit together, and so the exclusion is a cheap
 * path test rather than a content sniff.
 *
 * Excluded in THREE places, because three gate surfaces would otherwise run it:
 *   1. `routeSpecsToLanes` (leaf-gate) — the shared chokepoint for every lane-based gate, so the
 *      per-file leaf gate and the epic land gate both skip it.
 *   2. `findBunTestFiles` (scripts/test-backend.ts) — the backend regression floor's own walker.
 *   3. `ui/vitest.config.ts` exclude — the full-UI suite lane (`cd ui && bunx vitest --run`).
 * Miss any one and a committed red repro reds the gate it was written to stay out of.
 */

/** The path segment that marks a test as quarantined. */
export const QUARANTINE_SEGMENT = '__quarantine__';

/**
 * True if `path` is inside a quarantine directory. Accepts absolute or repo-relative paths and
 * both separators, because callers pass all of those: the land gate routes repo-relative POSIX
 * specs, the floor walker builds absolute native paths.
 *
 * Deliberately a SEGMENT test, not a substring test — a file named `my__quarantine__helper.ts`
 * is not quarantined, and neither is a directory called `not__quarantine__ed`.
 */
export function isQuarantined(path: string): boolean {
  if (!path) return false;
  return path.split(/[\\/]+/).includes(QUARANTINE_SEGMENT);
}

/** Split a list into the specs a gate should run and the quarantined ones it must skip.
 *  Returns both halves so a caller can REPORT what it skipped — a silently-dropped test is
 *  indistinguishable from a passing one, and this suite exists precisely to stay visible. */
export function partitionQuarantined<T extends string>(paths: readonly T[]): {
  run: T[];
  quarantined: T[];
} {
  const run: T[] = [];
  const quarantined: T[] = [];
  for (const p of paths) (isQuarantined(p) ? quarantined : run).push(p);
  return { run, quarantined };
}
