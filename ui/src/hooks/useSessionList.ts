import { useCallback, useEffect, useRef, useState } from 'react';
import { getWebSocketClient } from '../lib/websocket';
import type { SessionMetadata } from '../types/agent';

const sessionListCache = new Map<string, SessionMetadata[]>();

export function useSessionList(projectRoot?: string): {
  sessions: SessionMetadata[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const cacheKey = projectRoot ?? '';
  const [sessions, setSessions] = useState<SessionMetadata[]>(
    () => sessionListCache.get(cacheKey) ?? [],
  );
  const [loading, setLoading] = useState<boolean>(() => !sessionListCache.has(cacheKey));
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(() => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    const url = `/api/agent/sessions?mode=registry${
      projectRoot ? `&project_root=${encodeURIComponent(projectRoot)}` : ''
    }`;
    fetch(url, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const list: SessionMetadata[] = Array.isArray(data?.sessions) ? data.sessions : [];
        sessionListCache.set(cacheKey, list);
        setSessions(list);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        // Do not clear loading on AbortError — the next call already set
        // setLoading(true) and owns the loading state (BUG-07).
        if (err?.name !== 'AbortError') {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
  }, [cacheKey, projectRoot]);

  useEffect(() => {
    const cached = sessionListCache.get(cacheKey);
    if (cached) setSessions(cached);
    refetch();
    return () => abortRef.current?.abort();
  }, [cacheKey, refetch]);

  // Subscribe to sessions_list_invalidated WS messages
  useEffect(() => {
    const client = getWebSocketClient();
    if (!client) return;
    const sub = client.onMessage((msg: any) => {
      if (msg && msg.type === 'sessions_list_invalidated') {
        refetch();
      }
    });
    return () => {
      if (sub && typeof (sub as any).unsubscribe === 'function') {
        (sub as any).unsubscribe();
      } else if (typeof sub === 'function') {
        (sub as unknown as () => void)();
      }
    };
  }, [refetch]);

  return { sessions, loading, error, refetch };
}
