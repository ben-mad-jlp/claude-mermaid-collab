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
  const shouldPoll = inflightTodos.length > 0 || (daemon?.inflight?.length ?? 0) > 0;
  const pollRef = useRef(shouldPoll);
  pollRef.current = shouldPoll;
  useEffect(() => {
    if (!shouldPoll) return;
    const id = setInterval(() => { if (pollRef.current) setNonce((n) => n + 1); }, POLL_MS);
    return () => clearInterval(id);
  }, [shouldPoll]);

  const pausedSet = useMemo(
    () => new Set((daemon?.paused ?? []).map((p) => p.todoId)),
    [daemon],
  );
  const runningCount = (daemon?.inflight ?? []).length;
  const breakerOpen = !!daemon?.breaker?.open;

  // AUTHORITATIVE in-flight SET = union of (a) the daemon's live leaf-inflight ledger —
  // the headless leaves running RIGHT NOW, which a local funnel misses because a headless
  // leaf doesn't flip its todo's local status — and (b) the local claimed/in_progress
  // todos (the "between nodes" case the ledger drops). Joined on leafId === todoId. Without
  // (a) an actively-building project read "0 in flight" while two leaves blueprinted.
  const rows = useMemo(() => {
    const m = new Map<string, { id: string; title: string; todo?: SessionTodo; leaf?: InflightLeaf }>();
    for (const t of inflightTodos) m.set(t.id, { id: t.id, title: t.title ?? t.id, todo: t });
    for (const leaf of daemon?.inflight ?? []) {
      const ex = m.get(leaf.leafId);
      if (ex) { ex.leaf = leaf; continue; }
      const t = todos.find((x) => x.id === leaf.leafId);
      m.set(leaf.leafId, { id: leaf.leafId, title: t?.title ?? leaf.leafId.slice(0, 8), todo: t, leaf });
    }
    return [...m.values()];
  }, [inflightTodos, daemon, todos]);

  if (rows.length === 0) {
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
        <span className="font-semibold text-info-700 dark:text-info-400">{rows.length} in flight</span>
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
        {rows.map((row) => {
          const leaf = row.leaf;
          const t = row.todo;
          const running = !!leaf;
          const nodeLabel = leaf?.nodeKind ? NODE_LABEL[leaf.nodeKind] ?? leaf.nodeKind : null;
          const elapsed = leaf ? now - leaf.startedAt : null;
          const paused = pausedSet.has(row.id);
          const clickable = !!(onSelectTodo && t);
          return (
            <div
              key={row.id}
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
                  onClick={clickable ? () => onSelectTodo!(t!) : undefined}
                  title={clickable ? `Open ${row.title} — full headless run stats` : row.title}
                  className={`flex-1 min-w-0 truncate text-left text-xs font-medium text-gray-800 dark:text-gray-100 ${clickable ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
                >
                  {row.title}
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
                {typeof t?.retryCount === 'number' && t.retryCount > 0 && (
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
