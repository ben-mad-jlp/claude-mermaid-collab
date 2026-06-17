/**
 * InflightPanel — the Bridge "In-flight" tab. Lists the todos currently being
 * worked by the HEADLESS leaf-executor (the only worker path; tmux is deprecated)
 * with their live stats.
 *
 * LIVE SOURCE: GET /api/leaf-executor/daemon?project= → { inflight:[{ leafId, nodeKind,
 * model, attempt, startedAt, elapsedMs, stale }], breaker, paused, ... }. This is the
 * authoritative "what is the daemon running right now" read (the headless path does NOT
 * emit the deprecated `worker_phase` lane events). The funnel `inflight` predicate gives
 * the todo SET + titles; the daemon read enriches each with its current node/model/elapsed.
 * Refresh: ws `session_todos_updated` nudge + a bounded 2.5s poll (no new ws event).
 *
 * Click a row to open its detail tab for the full headless run strip (per-node cost,
 * outcome, review verdict, expandable output).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { getWebSocketClient } from '@/lib/websocket';
import { apiFetch } from '@/lib/api';
import { excludeEpics, bucketTodo } from './funnel';

interface InflightLeaf {
  leafId: string;
  project: string;
  epicId: string | null;
  nodeKind: string | null;
  model: string | null;
  attempt: number | null;
  startedAt: number;
  elapsedMs: number;
  stale: boolean;
}

interface DaemonResponse {
  now: number;
  inflight?: InflightLeaf[];
  breaker?: { open: boolean; openUntil: number | null };
  paused?: Array<{ todoId: string; project: string; firstTrippedAt: number | null }>;
}

const NODE_LABEL: Record<string, string> = {
  blueprint: 'Blueprint',
  implement: 'Implement',
  wimplement: 'Implement',
  review: 'Review',
  research: 'Research',
  verify: 'Verify',
  fix: 'Fix',
};

const POLL_MS = 2500;

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

export interface InflightPanelProps {
  todos: SessionTodo[];
  project: string;
  serverScope: string;
  onJump?: (project: string, session: string) => void;
  onSelectTodo?: (todo: SessionTodo) => void;
  embedded?: boolean;
}

export const InflightPanel: React.FC<InflightPanelProps> = ({
  todos,
  project,
  serverScope,
  onSelectTodo,
}) => {
  const [daemon, setDaemon] = useState<DaemonResponse | null>(null);
  const [nonce, setNonce] = useState(0);
  // Tick so elapsed counters advance between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The SAME predicate the funnel bar uses (epics excluded), for the todo set + titles.
  const inflightTodos = useMemo(
    () => {
      const byId = new Map(todos.map((t) => [t.id, t]));
      return excludeEpics(todos).filter((t) => bucketTodo(t, byId) === 'inflight');
    },
    [todos],
  );

  // Live daemon read (headless leaf-executor). Server-aware so it hits the per-server
  // backend that owns the ledger (desktop/multi-server).
  useEffect(() => {
    let cancelled = false;
    const qs = project ? `?project=${encodeURIComponent(project)}` : '';
    apiFetch(serverScope, `/api/leaf-executor/daemon${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DaemonResponse | null) => {
        if (!cancelled) setDaemon(d);
      })
      .catch(() => {
        if (!cancelled) setDaemon(null);
      });
    return () => {
      cancelled = true;
    };
  }, [project, serverScope, nonce]);

  // ws nudge + bounded poll while anything is in flight (no new ws event).
  useEffect(() => {
    const client = getWebSocketClient();
    const sub = client.onMessage((msg: any) => {
      if (msg?.type === 'session_todos_updated' || msg?.type === 'worker_phase') setNonce((n) => n + 1);
    });
    return () => sub.unsubscribe();
  }, []);
  const shouldPoll = inflightTodos.length > 0;
  const pollRef = useRef(shouldPoll);
  pollRef.current = shouldPoll;
  useEffect(() => {
    if (!shouldPoll) return;
    const id = setInterval(() => { if (pollRef.current) setNonce((n) => n + 1); }, POLL_MS);
    return () => clearInterval(id);
  }, [shouldPoll]);

  const byLeaf = useMemo(() => {
    const m = new Map<string, InflightLeaf>();
    for (const r of daemon?.inflight ?? []) m.set(r.leafId, r);
    return m;
  }, [daemon]);
  const pausedSet = useMemo(
    () => new Set((daemon?.paused ?? []).map((p) => p.todoId)),
    [daemon],
  );
  const runningCount = (daemon?.inflight ?? []).length;
  const breakerOpen = !!daemon?.breaker?.open;

  if (inflightTodos.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="text-gray-400" aria-hidden="true">○</span>
        <span>Nothing in flight right now.</span>
      </div>
    );
  }

  return (
    <div data-testid="inflight-panel" className="space-y-2">
      {/* Roster header — in-flight count, how many are actively running a node, breaker. */}
      <div className="flex flex-wrap items-center gap-2 text-2xs text-gray-500 dark:text-gray-400">
        <span className="font-semibold text-info-700 dark:text-info-400">{inflightTodos.length} in flight</span>
        {runningCount > 0 && (
          <>
            <span className="text-gray-400">·</span>
            <span title="actively running a node right now">{runningCount} running</span>
          </>
        )}
        {breakerOpen && (
          <>
            <span className="text-gray-400">·</span>
            <span className="text-danger-600 dark:text-danger-400 font-medium" title="headless breaker is open — new spawns paused">⚠ breaker open</span>
          </>
        )}
      </div>

      <div className="space-y-1.5">
        {inflightTodos.map((t) => {
          const leaf = byLeaf.get(t.id);
          const running = !!leaf;
          const nodeLabel = leaf?.nodeKind ? NODE_LABEL[leaf.nodeKind] ?? leaf.nodeKind : null;
          const elapsed = leaf ? now - leaf.startedAt : null;
          const paused = pausedSet.has(t.id);
          return (
            <div
              key={t.id}
              data-testid="inflight-row"
              className="rounded border border-info-200 dark:border-info-900/50 bg-info-50/40 dark:bg-info-900/15 px-2.5 py-2 space-y-1"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    leaf?.stale ? 'bg-amber-500' : running ? 'bg-info-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  title={leaf?.stale ? 'node running > 15m (stale)' : running ? 'running a node' : 'in-flight (between nodes)'}
                />
                <button
                  type="button"
                  onClick={onSelectTodo ? () => onSelectTodo(t) : undefined}
                  title={onSelectTodo ? `Open ${t.title} — full headless run stats` : t.title}
                  className={`flex-1 min-w-0 truncate text-left text-xs font-medium text-gray-800 dark:text-gray-100 ${onSelectTodo ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
                >
                  {t.title}
                </button>
                {elapsed != null && (
                  <span className="shrink-0 text-2xs tabular-nums text-gray-600 dark:text-gray-300" title="time on current node">
                    {fmtDuration(elapsed)}
                  </span>
                )}
              </div>
              {/* Stat line: current node · model · attempt · paused/retry. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-3xs text-gray-500 dark:text-gray-400">
                {nodeLabel ? (
                  <span className="font-medium text-info-700 dark:text-info-300">{nodeLabel}</span>
                ) : paused ? (
                  <span className="text-warning-600 dark:text-warning-400 italic">paused (breaker)</span>
                ) : (
                  <span className="italic">between nodes</span>
                )}
                {leaf?.model && (
                  <span className="px-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300" title={leaf.model}>
                    {leaf.model}
                  </span>
                )}
                {leaf?.attempt != null && leaf.attempt > 1 && (
                  <span title="attempt">attempt {leaf.attempt}</span>
                )}
                {typeof t.retryCount === 'number' && t.retryCount > 0 && (
                  <span className="text-warning-600 dark:text-warning-400" title="lease retries">⟳{t.retryCount}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InflightPanel;
