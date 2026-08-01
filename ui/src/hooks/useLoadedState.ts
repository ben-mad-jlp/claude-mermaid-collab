import { useState } from 'react';

export type LoadStatus = 'loading' | 'loaded' | 'error';

export interface UseLoadedState<T> {
  data: T;
  status: LoadStatus;
  hasLoadedOnce: boolean;
  error: unknown;
  settle: (next: T) => void;
  fail: (err: unknown) => void;
  reset: () => void;
}

export function useLoadedState<T>(initial: T): UseLoadedState<T> {
  const [data, setData] = useState<T>(initial);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const settle = (next: T) => {
    setData(next);
    setStatus('loaded');
    setHasLoadedOnce(true);
    setError(null);
  };

  const fail = (err: unknown) => {
    setStatus('error');
    setHasLoadedOnce(true);
    setError(err);
  };

  const reset = () => {
    setData(initial);
    setStatus('loading');
    setHasLoadedOnce(false);
    setError(null);
  };

  return { data, status, hasLoadedOnce, error, settle, fail, reset };
}
