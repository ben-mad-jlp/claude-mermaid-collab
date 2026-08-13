import { useEffect, useState, useCallback } from 'react';
import { getWebSocketClient } from '@/lib/websocket';
import { InboxEnvelope, INBOX_LIST_PATH } from './artifactInbox';

const POLL_MS = 15000;

/** The GET route returns a FLATTENED metadata projection ({type, name} at the top
 *  level, no nested artifact — the content is deliberately not shipped in the list),
 *  while the components render the stored InboxEnvelope shape. Normalize here, at the
 *  single fetch boundary, accepting either shape — a row that still lacks the basics
 *  after normalization is dropped rather than rendered (a malformed envelope must
 *  never crash the whole sidebar; incident 2026-08-13: envelope.artifact.type on the
 *  flattened row killed every session-selected surface). */
export function normalizeEnvelope(raw: unknown): InboxEnvelope | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (typeof r.envelopeId !== 'string') return null;
  const artifact = (r.artifact && typeof r.artifact === 'object')
    ? r.artifact
    : { type: r.type, name: r.name, content: r.content ?? '' };
  if (typeof artifact.type !== 'string' || typeof artifact.name !== 'string') return null;
  return {
    schemaVersion: r.schemaVersion ?? 1,
    envelopeId: r.envelopeId,
    receivedAt: r.receivedAt ?? '',
    from: (r.from && typeof r.from === 'object') ? r.from : {},
    artifact: { type: artifact.type, name: artifact.name, content: artifact.content ?? '', metadata: artifact.metadata },
    historyNote: r.historyNote,
    state: r.state ?? 'pending',
    adoptedTo: r.adoptedTo,
  };
}

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
      .then((d: { envelopes?: unknown[] } | unknown[] | null) => {
        if (!cancelled) {
          let data: unknown[] = [];
          if (Array.isArray(d)) {
            data = d;
          } else if (d && 'envelopes' in d) {
            data = d.envelopes ?? [];
          }
          const normalized = data
            .map(normalizeEnvelope)
            .filter((e): e is InboxEnvelope => e !== null && e.state === 'pending');
          setEnvelopes(normalized);
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
