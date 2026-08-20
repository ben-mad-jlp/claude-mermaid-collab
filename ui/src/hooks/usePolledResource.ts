import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

export const POLL_INTERVAL_MS = 15_000;

export interface PolledResource<T> {
  data: T | undefined;
  isRefreshing: boolean;
  error: unknown;
  refreshNow: () => void;
}

const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeTick(fn: () => void): () => void {
  subscribers.add(fn);
  if (subscribers.size === 1) {
    timer = setInterval(() => {
      for (const f of [...subscribers]) f();
    }, POLL_INTERVAL_MS);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const cache = new Map<string, unknown>();

/**
 * Shared-ticker stale-while-revalidate poller.
 *
 * Stable-identity discipline (see useLoadedState): `fetcher` lives in a ref so an
 * inline arrow each render cannot re-fire the subscribe/fetch effect. The effect
 * depends on `[key, project]` only; `refreshNow` is `useCallback([])`.
 */
export function usePolledResource<T>(
  key: string,
  project: string | undefined,
  fetcher: (project: string, signal?: AbortSignal) => Promise<T>,
): PolledResource<T> {
  const [, forceRender] = useReducer((c: number) => c + 1, 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const projectRef = useRef(project);
  projectRef.current = project;

  const keyRef = useRef(key);
  keyRef.current = key;

  const seqRef = useRef(0);
  const inFlightRef = useRef<{
    project: string;
    controller: AbortController;
    seq: number;
  } | null>(null);

  const cacheKey = project !== undefined ? `${key}::${project}` : null;
  const data = (cacheKey !== null ? cache.get(cacheKey) : undefined) as T | undefined;

  const runFetch = useCallback(() => {
    const activeProject = projectRef.current;
    if (activeProject === undefined) {
      return;
    }

    const prev = inFlightRef.current;
    if (prev) {
      prev.controller.abort();
    }

    const seq = ++seqRef.current;
    const controller = new AbortController();
    inFlightRef.current = { project: activeProject, controller, seq };

    setIsRefreshing(true);

    const fetchKey = keyRef.current;
    const requestedProject = activeProject;

    fetcherRef
      .current(requestedProject, controller.signal)
      .then((value) => {
        if (seq !== seqRef.current || requestedProject !== projectRef.current) {
          return;
        }
        cache.set(`${fetchKey}::${requestedProject}`, value);
        setError(null);
        setIsRefreshing(false);
        if (inFlightRef.current?.seq === seq) {
          inFlightRef.current = null;
        }
        forceRender();
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current || requestedProject !== projectRef.current) {
          return;
        }
        // Aborts from superseded fetches are not errors for the current view.
        if (controller.signal.aborted) {
          return;
        }
        setError(err);
        setIsRefreshing(false);
        if (inFlightRef.current?.seq === seq) {
          inFlightRef.current = null;
        }
        forceRender();
      });
  }, []);

  const tickRef = useRef(runFetch);
  tickRef.current = runFetch;

  // Stable identity: never close over runFetch / fetcher (see useLoadedState).
  const refreshNow = useCallback(() => {
    tickRef.current();
  }, []);

  useEffect(() => {
    if (project === undefined) {
      setIsRefreshing(false);
      setError(null);
      const prev = inFlightRef.current;
      if (prev) {
        prev.controller.abort();
        inFlightRef.current = null;
      }
      return;
    }

    const onTick = () => {
      tickRef.current();
    };
    const unsubscribe = subscribeTick(onTick);
    tickRef.current();

    return () => {
      unsubscribe();
      const prev = inFlightRef.current;
      if (prev) {
        prev.controller.abort();
        inFlightRef.current = null;
      }
    };
    // Intentionally [key, project] only — fetcher is held in a ref.
  }, [key, project]);

  return {
    data: project === undefined ? undefined : data,
    isRefreshing: project === undefined ? false : isRefreshing,
    error: project === undefined ? null : error,
    refreshNow,
  };
}
