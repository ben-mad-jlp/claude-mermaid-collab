import { useCallback, useEffect, useRef, useState } from 'react';
import { getWebSocketClient } from '../lib/websocket';
import type { CostTotals, SessionCostTurn } from '../types/agent';

export function useSessionCost(sessionId: string | null): {
  totals: CostTotals | null;
  turns: SessionCostTurn[];
  loading: boolean;
  error: Error | null;
} {
  const [totals, setTotals] = useState<CostTotals | null>(null);
  const [turns, setTurns] = useState<SessionCostTurn[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(() => {
    if (!sessionId) {
      setTotals(null);
      setTurns([]);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/cost`, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        setTotals(data?.totals ?? null);
        setTurns(Array.isArray(data?.turns) ? data.turns : []);
        setError(null);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    refetch();
    return () => abortRef.current?.abort();
  }, [refetch]);

  // Refetch on turn_end events for this session
  useEffect(() => {
    if (!sessionId) return;
    const client = getWebSocketClient();
    if (!client) return;
    const sub = client.onMessage((msg: any) => {
      if (
        msg &&
        msg.type === 'agent_event' &&
        msg.event?.kind === 'turn_end' &&
        msg.event?.sessionId === sessionId
      ) {
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
  }, [sessionId, refetch]);

  return { totals, turns, loading, error };
}
