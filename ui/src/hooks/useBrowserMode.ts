import { useEffect, useState } from 'react';
import type { ServerInfo } from '@/contexts/ServerContext';

export function useBrowserMode(server?: ServerInfo): 'streamed' | 'native' | 'unknown' {
  const [mode, setMode] = useState<'streamed' | 'native' | 'unknown'>('unknown');

  useEffect(() => {
    let cancelled = false;
    const fetchMode = async () => {
      try {
        const mc = (window as any).mc;
        let streamed = false;
        if (mc?.invokeOnServer && server) {
          const res = await mc.invokeOnServer(server.id, { path: '/api/browser/mode', method: 'GET' });
          const body = res?.body ?? res?.data ?? res;
          const data = typeof body === 'string' ? JSON.parse(body) : body;
          streamed = data?.streamed === true;
        } else {
          const r = await fetch('/api/browser/mode');
          if (r.ok) {
            const data = await r.json();
            streamed = data?.streamed === true;
          }
        }
        if (!cancelled) setMode(streamed ? 'streamed' : 'native');
      } catch {
        if (!cancelled) setMode('native');
      }
    };
    void fetchMode();
    return () => { cancelled = true; };
  }, [server?.id, server?.host, server?.port]);

  return mode;
}
