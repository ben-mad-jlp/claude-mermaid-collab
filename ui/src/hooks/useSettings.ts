import { useCallback, useEffect, useRef, useState } from 'react';
import { getWebSocketClient } from '../lib/websocket';

export type Settings = Record<string, unknown>;

export interface UseSettingsReturn {
  data: Settings | null;
  loading: boolean;
  error: Error | null;
  mutate: (optimistic?: Settings) => Promise<void>;
}

let settingsCache: Settings | null = null;

export function useSettings(): UseSettingsReturn {
  const [data, setData] = useState<Settings | null>(settingsCache);
  const [loading, setLoading] = useState(settingsCache === null);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await fetch('/api/settings', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as Settings;
      settingsCache = json;
      setData(json);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  const mutate = useCallback(async (optimistic?: Settings) => {
    if (optimistic !== undefined) setData(optimistic);
    await refetch();
  }, [refetch]);

  useEffect(() => {
    refetch();
    return () => { abortRef.current?.abort(); };
  }, [refetch]);

  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: unknown) => {
      const m = msg as { type?: string } | null;
      if (m?.type === 'settings_updated') {
        refetch();
      }
    });
    return () => {
      sub.unsubscribe();
    };
  }, [refetch]);

  return { data, loading, error, mutate };
}
