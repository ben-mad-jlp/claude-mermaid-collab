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

interface DaemonStatus {
  now: number;
  inflight: Array<{
    leafId: string;
    epicId: string | null;
    nodeKind: string | null;
    model: string | null;
    attempt: number | null;
    startedAt: number;
    elapsedMs: number;
    stale: boolean;
  }>;
  breaker: { open: boolean; openUntil: number };
  paused: Array<{
    todoId: string;
    project: string;
    firstTrippedAt: number | null;
  }>;
  recentSpawns: Array<{
    id?: string;
    ts?: number;
    project?: string;
    session?: string;
    detail?: string | null;
    serverId?: string;
  }>;
  failures: Array<{
    leafId: string;
    finalOutcome: string | null;
    reason: string | null;
    pathTaken?: string | null;
    nodesSpent?: number;
  }>;
}

// Slow bounded poll — this is evidence, not a live tail. ws nudge is the primary refresh.
const POLL_MS = 15000;
const LIVE_POLL_MS = 4000;

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

const DaemonSection: React.FC<{ daemon: DaemonStatus | null; tick: number; onResetBreaker?: () => void }> = ({ daemon, tick, onResetBreaker }) => {
  void tick; // triggers re-render each second for elapsed display
  if (!daemon) return null;
  const hasBreaker = daemon.breaker.open;
  const hasInflight = daemon.inflight.length > 0;
  const hasPaused = daemon.paused.length > 0;
  const hasSpawns = daemon.recentSpawns.length > 0;
  const hasFailures = daemon.failures.length > 0;
  if (!hasBreaker && !hasInflight && !hasPaused && !hasSpawns && !hasFailures) return null;
  return (
    <div className="px-3 pb-3 border-b border-gray-200/70 dark:border-gray-700/70 space-y-2 pt-3">
      {/* Sub-block 1: Breaker badge */}
      <div
        data-testid="daemon-breaker"
        className={`rounded px-3 py-2 text-2xs ${
          hasBreaker
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-bold'
            : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
        }`}
      >
        {hasBreaker ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span>circuit breaker OPEN — headless spawns paused</span>
              {onResetBreaker && (
                <button
                  type="button"
                  onClick={onResetBreaker}
                  title="Force-close the breaker now (otherwise it auto-closes after the rate-limit cooldown)"
                  className="shrink-0 rounded px-2 py-0.5 text-3xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="mt-1 font-normal tabular-nums">
              until {new Date(daemon.breaker.openUntil).toLocaleTimeString()} ·{' '}
              {fmtDuration(daemon.breaker.openUntil - daemon.now)} remaining
            </div>
          </>
        ) : (
          <div>breaker: closed ✓</div>
        )}
      </div>

      {/* Sub-block 2: Running leaves */}
      {hasInflight && (
        <div data-testid="daemon-inflight">
          <div className="text-2xs uppercase tracking-wide text-gray-400 mb-1">
            running now ({daemon.inflight.length})
          </div>
          {daemon.inflight.map((r) => (
            <div key={r.leafId} className="flex items-center gap-2 py-0.5">
              <span
                className={`h-2 w-2 rounded-full shrink-0 animate-pulse ${
                  r.stale ? 'bg-amber-500' : 'bg-accent-500'
                }`}
              />
              <span
                className={`text-2xs ${
                  r.stale ? 'text-amber-600 dark:text-amber-400' : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                {r.leafId.slice(0, 8)} · {r.nodeKind ?? 'node'}
              </span>
              {r.model && (
                <span className="text-3xs text-gray-400 truncate max-w-[7rem]">{r.model}</span>
              )}
              <span className="ml-auto text-2xs tabular-nums text-gray-500">
                {fmtDuration(Date.now() - r.startedAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Sub-block 3: Paused queue */}
      {hasPaused && (
        <div data-testid="daemon-paused" className="text-2xs text-gray-500">
          paused on cap ({daemon.paused.length}):{' '}
          <span className="tabular-nums">
            {daemon.paused.map((p) => p.todoId.slice(0, 8)).join(' · ')}
          </span>
        </div>
      )}

      {/* Sub-block 4: Recent spawns */}
      {hasSpawns && (
        <div data-testid="daemon-spawns">
          <div className="text-2xs uppercase tracking-wide text-gray-400 mb-1">recent spawns</div>
          {daemon.recentSpawns.slice(0, 5).map((s, i) => {
            let parsed: { suppressed?: boolean; outcome?: string } | null = null;
            try {
              parsed = s.detail ? JSON.parse(s.detail) : null;
            } catch {}
            const isSuppressed = parsed?.suppressed || parsed?.outcome === 'suppressed';
            return (
              <div
                key={s.id ?? i}
                className={`text-2xs truncate ${
                  isSuppressed ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'
                }`}
              >
                {s.detail ?? s.session ?? '—'}
              </div>
            );
          })}
        </div>
      )}

      {/* Sub-block 5: Recent failures */}
      {hasFailures && (
        <div data-testid="daemon-failures">
          <div className="text-2xs uppercase tracking-wide text-gray-400 mb-1">recent failures</div>
          {daemon.failures.slice(0, 5).map((f) => {
            const isRed = f.finalOutcome === 'rejected' || f.finalOutcome === 'blocked';
            const isYellow = f.finalOutcome === 'pending';
            return (
              <div
                key={f.leafId}
                className={`text-2xs tabular-nums ${
                  isRed
                    ? 'text-red-600 dark:text-red-400'
                    : isYellow
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-500'
                }`}
              >
                {f.leafId.slice(0, 8)} · {f.finalOutcome}
                {f.reason ? ` · ${f.reason}` : ''}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const ExecutorStatsPanel: React.FC<{
  project?: string;
  epicId?: string;
  serverScope?: string;
}> = ({ project, epicId }) => {
  const [data, setData] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetchNonce, setRefetchNonce] = useState(0);
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);
  const [tick, setTick] = useState(0);

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

  // Daemon fetch — same nonce dep so it rides the ws nudge and bounded poll.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (project) params.set('project', project);
    if (epicId) params.set('epicId', epicId);
    const qs = params.toString();
    fetch(`/api/leaf-executor/daemon${qs ? `?${qs}` : ''}`)
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

  // Liveness poll: faster cadence gated on actual live activity to avoid perpetual 4s poll.
  useEffect(() => {
    const hasLiveActivity = (daemon?.inflight?.length ?? 0) > 0 || daemon?.breaker?.open;
    if (!hasLiveActivity) return;
    const id = setInterval(() => setRefetchNonce((n) => n + 1), LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [(daemon?.inflight?.length ?? 0) > 0, daemon?.breaker?.open]);

  // Tick interval: 1s re-render for ticking elapsed on inflight leaves.
  useEffect(() => {
    if (!daemon?.inflight?.length) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [daemon?.inflight?.length]);

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

      {/* LIVE DAEMON SECTION — above aggregate tiles so live view leads, evidence follows. */}
      <DaemonSection
        daemon={daemon}
        tick={tick}
        onResetBreaker={() => {
          void fetch('/api/leaf-executor/breaker-reset', { method: 'POST' }).catch(() => {});
          setRefetchNonce((n) => n + 1);
        }}
      />

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
