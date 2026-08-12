import { useEffect, useState, useCallback } from 'react';
import { getWebSocketClient } from '@/lib/websocket';
import { InboxEnvelope, INBOX_LIST_PATH } from './artifactInbox';

const POLL_MS = 15000;

export function useArtifactInbox(): { envelopes: InboxEnvelope[]; loading: boolean; refetch: () => void } {
  const [envelopes, setEnvelopes] = useState<InboxEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [refetchNonce, setRefetchNonce] = useState(0);

  const refetch = useCallback(() => {
    setRefetchNonce((n) => n + 1);
  }, []);

  // Fetch effect
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(INBOX_LIST_PATH)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { envelopes?: InboxEnvelope[] } | InboxEnvelope[] | null) => {
        if (!cancelled) {
          let data: InboxEnvelope[] = [];
          if (Array.isArray(d)) {
            data = d;
          } else if (d && 'envelopes' in d) {
            data = d.envelopes ?? [];
          }
          setEnvelopes(data.filter((e) => e.state === 'pending'));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnvelopes([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refetchNonce]);

  // WS effect with null-safe client
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client?.onMessage((msg: any) => {
      if (msg?.type === 'artifact_inbox_updated') {
        setRefetchNonce((n) => n + 1);
      }
    });
    return () => sub?.unsubscribe();
  }, []);

  // Bounded slow-poll fallback
  useEffect(() => {
    const id = setInterval(() => setRefetchNonce((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return { envelopes, loading, refetch };
}
