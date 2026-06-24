/**
 * DogfoodHealthPanel — read-only dogfood-health surface for the Bridge "Dogfood" tab.
 * Shows recurring friction reasons, unlanded-epic count (with amber CTA over threshold),
 * and stale-worktree count. Self-contained fetch; no store wiring. Modeled on
 * ExecutorStatsPanel (slow bounded poll + ws nudge, ONE-card chrome).
 */
import React, { useEffect, useState } from 'react';
import { getWebSocketClient } from '@/lib/websocket';

interface FrictionTrends {
  total: number;
  considered: number;
  byLayer: Array<{
    layer: string;
    count: number;
    reasons: Array<{ retryReason: string; count: number; sessions: string[]; lastAt: string }>;
  }>;
  recurring: Array<{ layer: string; retryReason: string; count: number }>;
}

const POLL_MS = 15000;
const UNLANDED_THRESHOLD = 2;

export const DogfoodHealthPanel: React.FC<{
  project?: string;
  serverScope?: string;
}> = ({ project }) => {
  const [trends, setTrends] = useState<FrictionTrends | null>(null);
  const [unlandedCount, setUnlandedCount] = useState<number | null>(null);
  const [staleCount, setStaleCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetchNonce, setRefetchNonce] = useState(0);

  // Friction trends fetch
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/supervisor/friction-trends?project=${encodeURIComponent(project)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FrictionTrends | null) => {
        if (!cancelled) setTrends(d);
      })
      .catch(() => {
        if (!cancelled) setTrends(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project, refetchNonce]);

  // Unlanded epics fetch
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    fetch(`/api/supervisor/unlanded-epics?project=${encodeURIComponent(project)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { unlandedEpics?: unknown[] } | null) => {
        if (!cancelled) setUnlandedCount((d?.unlandedEpics ?? []).length);
      })
      .catch(() => {
        if (!cancelled) setUnlandedCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [project, refetchNonce]);

  // Stale worktrees fetch
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    fetch(`/api/supervisor/stale-worktrees?project=${encodeURIComponent(project)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { staleWorktrees?: unknown[] } | null) => {
        if (!cancelled) setStaleCount((d?.staleWorktrees ?? []).length);
      })
      .catch(() => {
        if (!cancelled) setStaleCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [project, refetchNonce]);

  // ws nudge (primary): bump nonce on `session_todos_updated`. NO new event type (b2fe36b1).
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (msg?.type === 'session_todos_updated') setRefetchNonce((n) => n + 1);
    });
    return () => sub.unsubscribe();
  }, []);

  // Bounded poll (fallback): slow interval, mounted only while this tab is rendered.
  useEffect(() => {
    const id = setInterval(() => setRefetchNonce((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const unlanded = unlandedCount ?? 0;
  const stale = staleCount ?? 0;
  const overThreshold = unlanded > UNLANDED_THRESHOLD;

  return (
    <div className="m-3 mb-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200/70 dark:border-gray-700/70 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">dogfood health</span>
        <span className="ml-auto flex items-center gap-2">
          {loading && !trends && (
            <span className="text-2xs text-gray-400 dark:text-gray-500 italic">loading…</span>
          )}
          <button
            type="button"
            data-testid="dogfood-health-refresh"
            aria-label="Refresh dogfood health"
            onClick={() => setRefetchNonce((n) => n + 1)}
            className="text-2xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 leading-none"
          >
            ↺
          </button>
        </span>
      </div>

      {/* Count tiles */}
      <div className="grid grid-cols-2 gap-3 px-3 py-3">
        <Tile
          testid="dogfood-unlanded"
          label="Unlanded epics"
          value={String(unlanded)}
          amber={overThreshold}
        />
        <Tile
          testid="dogfood-stale-worktrees"
          label="Stale worktrees"
          value={String(stale)}
          amber={stale > 0}
        />
      </div>

      {/* Unlanded CTA band — amber, not red (one-red rule) */}
      {overThreshold && (
        <div
          data-testid="dogfood-unlanded-cta"
          className="mx-3 mb-3 rounded px-3 py-2 text-2xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
        >
          {unlanded} epics stranded off master — land them (Bridge ▸ Land tab)
        </div>
      )}

      {/* Recurring friction list */}
      <div data-testid="dogfood-recurring" className="px-3 pb-3">
        {(trends?.recurring.length ?? 0) === 0 ? (
          <p className="text-2xs text-gray-400 dark:text-gray-500 italic">No recurring friction.</p>
        ) : (
          <>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">recurring friction</div>
            {trends!.recurring.slice(0, 6).map((r) => (
              <div
                key={`${r.layer}:${r.retryReason}`}
                className="flex items-center gap-2 py-0.5"
              >
                <span className="text-2xs text-gray-700 dark:text-gray-200 truncate flex-1">
                  {r.retryReason}
                </span>
                <span className="text-3xs text-gray-400 shrink-0">{r.layer}</span>
                <span className="text-2xs tabular-nums text-gray-500 shrink-0">×{r.count}</span>
              </div>
            ))}
            {(trends!.byLayer.length ?? 0) > 0 && (
              <div className="mt-1 text-[10px] text-gray-500">
                {trends!.byLayer.map((l) => `${l.layer} ${l.count}`).join(' · ')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const Tile: React.FC<{ testid: string; label: string; value: string; amber?: boolean }> = ({
  testid,
  label,
  value,
  amber,
}) => (
  <div className="flex flex-col">
    <span
      data-testid={testid}
      className={`text-2xl tabular-nums leading-tight ${
        amber ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'
      }`}
    >
      {value}
    </span>
    <span className="text-xs uppercase tracking-wide text-gray-400">{label}</span>
  </div>
);

export default DogfoodHealthPanel;
