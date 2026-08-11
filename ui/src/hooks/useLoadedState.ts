import { useCallback, useRef, useState } from 'react';

export type LoadStatus = 'loading' | 'loaded' | 'error';

export interface UseLoadedState<T> {
  data: T;
  status: LoadStatus;
  hasLoadedOnce: boolean;
  error: unknown;
  settle: (next: T) => void;
  /** Functional settle. The only correct way to derive the next value from the previous one
   *  inside a subscribe-once effect: reading `loaded.data` there captures the mount-time value
   *  forever (the old unstable callbacks masked this by resubscribing every render). */
  update: (fn: (prev: T) => T) => void;
  fail: (err: unknown) => void;
  reset: () => void;
}

/**
 * Load-state holder with STABLE function identities.
 *
 * `settle`/`fail`/`reset` used to be re-minted every render, and so was the returned object.
 * Any effect that listed `loaded` (or even `loaded.settle`) in its dependency array and then
 * called `settle` inside would re-render, get a new reference, and refire itself.
 *
 * MEASURED 2026-08-11: useMissions did exactly that. The Bridge rail fetched
 * /api/supervisor/missions in a tight cycle — ~15 requests/second, each costing ~400
 * synchronous SQLite queries in the sidecar (6,000 queries per 10s window, captured by the
 * hotpath profiler with JS stacks). bun:sqlite runs on the thread that answers /api/health,
 * so the loop starved the health probe and the Electron liveness watchdog SIGKILLed the
 * sidecar — 11 restarts in one afternoon, each misread as a daemon problem. Three daemon-side
 * fixes shipped before the profiler named the UI as the caller.
 *
 * The callbacks are stable (useCallback, state via functional updates / ref), so they are safe
 * in dependency arrays. The returned OBJECT is still fresh per render — depend on the fields
 * you use, never on the object itself.
 */
export function useLoadedState<T>(initial: T): UseLoadedState<T> {
  const [data, setData] = useState<T>(initial);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // `reset` must restore the ORIGINAL initial value without capturing it in a dep — a caller
  // passing a fresh `[]` literal each render would otherwise destabilise `reset`.
  const initialRef = useRef(initial);

  const settle = useCallback((next: T) => {
    setData(next);
    setStatus('loaded');
    setHasLoadedOnce(true);
    setError(null);
  }, []);

  const update = useCallback((fn: (prev: T) => T) => {
    setData(fn);
    setStatus('loaded');
    setHasLoadedOnce(true);
    setError(null);
  }, []);

  const fail = useCallback((err: unknown) => {
    setStatus('error');
    setHasLoadedOnce(true);
    setError(err);
  }, []);

  const reset = useCallback(() => {
    setData(initialRef.current);
    setStatus('loading');
    setHasLoadedOnce(false);
    setError(null);
  }, []);

  return { data, status, hasLoadedOnce, error, settle, update, fail, reset };
}
