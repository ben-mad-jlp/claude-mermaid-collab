import { useCallback, useEffect, useRef, useState } from 'react';
import { getWebSocketClient } from '../lib/websocket';

export interface McpServer {
  id: string;
  name: string;
  status: string;
  tokenCost?: number;
  [key: string]: unknown;
}

let serversCache: McpServer[] | null = null;

export function useMcpServers(): { servers: McpServer[]; loading: boolean; error: Error | null; refetch: () => void } {
  const [servers, setServers] = useState<McpServer[]>(serversCache ?? []);
  const [loading, setLoading] = useState(serversCache === null);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    fetch('/api/mcp/servers', { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ servers: McpServer[] }>;
      })
      .then(({ servers: s }) => {
        serversCache = s;
        setServers(s);
        setError(null);
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
    return () => { abortRef.current?.abort(); };
  }, [refetch]);

  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: unknown) => {
      const m = msg as { type?: string } | null;
      if (m?.type === 'mcp_server_added' || m?.type === 'mcp_server_removed') {
        refetch();
      }
    });
    return () => {
      sub.unsubscribe();
    };
  }, [refetch]);

  return { servers, loading, error, refetch };
}
