export const HARNESS_TIMEOUT_FLOOR_MS = 30000;

/**
 * Mirrors the harness's timeout resolution from scripts/test-backend.ts:347-349.
 * Reads process.env.BACKEND_TEST_TIMEOUT_MS at call time (never cached) and
 * clamps the parsed value to the minimum floor. A missing, empty, or NaN value
 * resolves to the floor.
 */
export function harnessTimeoutMs(): number {
  const envValue = process.env.BACKEND_TEST_TIMEOUT_MS;
  const parsed = Number(envValue ?? '30000');
  return Math.max(HARNESS_TIMEOUT_FLOOR_MS, isNaN(parsed) ? HARNESS_TIMEOUT_FLOOR_MS : parsed);
}

/**
 * Returns 60% of the harness timeout as the deadlock guard threshold.
 * Strictly below harnessTimeoutMs for every reachable input (floor 30000 → 18000).
 */
export function deadlockGuardMs(): number {
  return Math.floor(harnessTimeoutMs() * 0.6);
}

/**
 * Races a promise against a timeout, rejecting with a labelled deadlock error
 * if the promise doesn't settle in time. The timer is cleared on settle to
 * prevent keeping the process alive.
 *
 * @param p The promise to race.
 * @param label A description of what's being guarded (included in error message).
 * @param timeoutMs Optional timeout in milliseconds; defaults to deadlockGuardMs().
 * @returns The value of p if it settles first, or rejects with a deadlock error.
 */
export function raceDeadlockGuard<T>(
  p: Promise<T>,
  label: string,
  timeoutMs: number = deadlockGuardMs(),
): Promise<T> {
  return Promise.race<T>([
    p,
    new Promise<T>((_, reject) => {
      const handle = setTimeout(() => {
        reject(new Error(`possible deadlock: ${label} did not settle within ${timeoutMs}ms`));
      }, timeoutMs);

      p.finally(() => {
        clearTimeout(handle);
        if (handle.unref) {
          handle.unref();
        }
      });
    }),
  ]);
}
