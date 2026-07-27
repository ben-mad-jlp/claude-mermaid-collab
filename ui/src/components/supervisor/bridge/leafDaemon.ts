import { useCallback, useEffect, useRef, useState } from 'react';
import { getWebSocketClient } from '@/lib/websocket';
import { apiFetch } from '@/lib/api';

export interface InflightLeaf {
  leafId: string;
  project?: string;
  epicId: string | null;
  nodeKind: string | null;
  model: string | null;
  attempt: number | null;
  startedAt: number;
  elapsedMs: number;
  stale: boolean;
}

export interface DaemonStatus {
  now: number;
  inflight?: InflightLeaf[];
  breaker?: { open: boolean; openUntil: number | null };
  paused?: Array<{ todoId: string; project: string; firstTrippedAt: number | null }>;
  recentSpawns?: Array<{ id?: string; ts?: number; project?: string; session?: string; detail?: string | null; serverId?: string }>;
  failures?: Array<{ leafId: string; finalOutcome: string | null; reason: string | null; pathTaken?: string | null; nodesSpent?: number }>;
  limits?: { global: { max: number; active: number }; project?: { max: number; active: number } };
  claimSuppression?: { claimable?: number; claimableIds?: string[] };
}

export const NODE_LABEL: Record<string, string> = {
  blueprint: 'Blueprint',
  implement: 'Implement',
  wimplement: 'Implement',
  review: 'Review',
  research: 'Research',
  verify: 'Verify',
  fix: 'Fix',
};

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

export function fmtElapsedPadded(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

const POLL_MS = 2500;

export function useLeafDaemon(
  project: string | null | undefined,
  serverScope = '',
  opts?: { epicId?: string; nonce?: number },
): { daemon: DaemonStatus | null; inflight: InflightLeaf[]; refetch: () => void } {
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);
  const [internalNonce, setInternalNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    if (project) qs.append('project', project);
    if (opts?.epicId) qs.append('epicId', opts.epicId);
    const qsStr = qs.toString() ? `?${qs.toString()}` : '';

    apiFetch(serverScope, `/api/leaf-executor/daemon${qsStr}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DaemonStatus | null) => {
        if (!cancelled) setDaemon(d);
      })
      .catch(() => {
        if (!cancelled) setDaemon(null);
      });

    return () => {
      cancelled = true;
    };
  }, [project, serverScope, opts?.epicId, internalNonce, opts?.nonce]);

  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (msg?.type === 'session_todos_updated' || msg?.type === 'worker_phase') {
        setInternalNonce((n) => n + 1);
      }
    });
    return () => sub.unsubscribe();
  }, []);

  const shouldPoll = (daemon?.inflight?.length ?? 0) > 0;
  const pollRef = useRef(shouldPoll);
  pollRef.current = shouldPoll;

  useEffect(() => {
    if (!shouldPoll) return;
    const id = setInterval(() => {
      if (pollRef.current) setInternalNonce((n) => n + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [shouldPoll]);

  const refetch = useCallback(() => {
    setInternalNonce((n) => n + 1);
  }, []);

  return {
    daemon,
    inflight: daemon?.inflight ?? [],
    refetch,
  };
}
