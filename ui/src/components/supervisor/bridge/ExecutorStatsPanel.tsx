/**
 * ExecutorStatsPanel — the AGGREGATE (fleet-level) evidence dashboard for the headless
 * leaf-executor, mounted in the Bridge as the "Executor" tab. Distinct from the per-todo
 * WorkerRunStrip: this composes the P4a fleet aggregation:
 *
 *   GET /api/leaf-executor/stats?project=&epicId=&since=  →  FleetStats (raw, no envelope)
 *
 * Mirrors WorkerRunStrip's fetch (cancelled-flag + nonce + existing `session_todos_updated`
 * ws nudge — NO new ws event, b2fe36b1) and card chrome (ONE card language, 329741da). The
 * SINGLE red in this panel is the auth-mode alarm band (subscription-only invariant). A slow
 * bounded poll (15s) runs only while the panel is mounted (the tab gates visibility).
 */
import React, { useEffect, useRef, useState } from 'react';
import { getWebSocketClient } from '@/lib/websocket';

interface FleetStats {
  leafCount: number;
  nodesPerLeafAvg: number;
  attemptRate: number;
  blockRate: number; // 0..1 fraction
  capPauseCount: number;
  capPauseMs: number;
  authModeAudit: Record<string, number>;
  authModeAlarm: boolean;
  wallClock: { p50: number; p90: number; max: number };
}

// Slow bounded poll — this is evidence, not a live tail. ws nudge is the primary refresh.
const POLL_MS = 15000;

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

export const ExecutorStatsPanel: React.FC<{
  project?: string;
  epicId?: string;
  serverScope?: string;
}> = ({ project, epicId }) => {
  const [data, setData] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetchNonce, setRefetchNonce] = useState(0);

  // Fetch (mirrors WorkerRunStrip's cancelled-flag shape). The response is the raw
  // FleetStats — there is NO `ran` envelope — so setData(d) directly.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (project) params.set('project', project);
    if (epicId) params.set('epicId', epicId);
    const qs = params.toString();
    fetch(`/api/leaf-executor/stats${qs ? `?${qs}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FleetStats | null) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project, epicId, refetchNonce]);

  // ws nudge (primary): bump the nonce on the existing `session_todos_updated` broadcast.
  // NO new event type (b2fe36b1).
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (msg?.type === 'session_todos_updated') setRefetchNonce((n) => n + 1);
    });
    return () => sub.unsubscribe();
  }, []);

  // Bounded poll (fallback): a slow interval, mounted only while the panel is rendered
  // (the tab unmounts it when another tab is active → inherently visible-only).
  useEffect(() => {
    const id = setInterval(() => setRefetchNonce((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const empty = !data || data.leafCount === 0;

  const offending = data
    ? Object.entries(data.authModeAudit).filter(([k, v]) => k !== 'subscription' && v > 0)
    : [];

  return (
    <div className="m-3 mb-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40">
      <div className="px-3 py-2 border-b border-gray-200/70 dark:border-gray-700/70 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">executor stats</span>
        <span className="ml-auto flex items-center gap-2">
          {loading && !data && (
            <span className="text-2xs text-gray-400 dark:text-gray-500 italic">loading…</span>
          )}
          <button
            type="button"
            data-testid="executor-stats-refresh"
            aria-label="Refresh executor stats"
            onClick={() => setRefetchNonce((n) => n + 1)}
            className="text-2xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 leading-none"
          >
            ↺
          </button>
        </span>
      </div>

      {empty ? (
        <div className="px-3 py-3">
          <p className="text-2xs text-gray-400 dark:text-gray-500 italic">No headless runs yet.</p>
        </div>
      ) : (
        <>
          {/* HERO TILES — hero number text-2xl tabular-nums over an uppercase label. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 px-3 py-3">
            <Tile testid="stat-leafcount" label="Leaves" value={String(data!.leafCount)} />
            <Tile testid="stat-nodesper" label="Nodes / leaf" value={data!.nodesPerLeafAvg.toFixed(1)} />
            <Tile testid="stat-attemptrate" label="Attempt rate" value={data!.attemptRate.toFixed(2)} />
            <Tile
              testid="stat-blockrate"
              label="Block rate"
              value={`${(data!.blockRate * 100).toFixed(0)}%`}
              amber={data!.blockRate > 0}
            />
            <Tile testid="stat-cappause" label="Cap pauses" value={String(data!.capPauseCount)} />
          </div>

          {/* AUTH-MODE AUDIT band — the subscription-only invariant made visible. THE red. */}
          <div className="px-3 pb-3">
            {data!.authModeAlarm ? (
              <div
                data-testid="authmode-audit"
                data-alarm="true"
                className="rounded px-3 py-2 text-2xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-bold"
              >
                <div>AUTH ALARM — non-subscription auth detected</div>
                <div className="mt-1 font-normal tabular-nums">
                  {offending.map(([k, v]) => `${k} ×${v}`).join(' · ')}
                </div>
              </div>
            ) : (
              <div
                data-testid="authmode-audit"
                data-alarm="false"
                className="rounded px-3 py-2 text-2xs bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              >
                <div>auth: subscription-only ✓</div>
                <div className="mt-1 tabular-nums">
                  {Object.entries(data!.authModeAudit)
                    .map(([k, v]) => `${k} ×${v}`)
                    .join(' · ')}
                </div>
              </div>
            )}
          </div>

          {/* WALL-CLOCK summary — quiet single line. */}
          <div className="px-3 pb-3">
            <p data-testid="wallclock-summary" className="text-2xs tabular-nums text-gray-500">
              wall-clock&nbsp; p50 {fmtDuration(data!.wallClock.p50)} · p90 {fmtDuration(data!.wallClock.p90)} · max{' '}
              {fmtDuration(data!.wallClock.max)}
            </p>
          </div>
        </>
      )}
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

export default ExecutorStatsPanel;
