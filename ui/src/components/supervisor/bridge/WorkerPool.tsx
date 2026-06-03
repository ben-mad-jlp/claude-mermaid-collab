/**
 * WorkerPool — role-typed session cards for the active project (Control-UI §4,
 * KPI #2). Liveness is derived INLINE from subscriptionStore freshness (no
 * supervisorLiveness helper): a session whose last update is stale is treated
 * as crashed; idle-with-ready-work is a warning; crashed-while-holding-a-todo
 * is danger. A tally header gives the <5s glance.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { diveLayoutId } from '@/components/stream/DiveTransition';

interface SubLike {
  serverId: string;
  project: string;
  session: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
}

export interface WorkerPoolProps {
  subscriptions: SubLike[];
  todos: SessionTodo[];
  onJump?: (project: string, session: string) => void;
  /** When set, clicking a card drills into WorkerDetail instead of jumping. */
  onSelect?: (session: string) => void;
}

const CRASH_MS = 120_000; // no heartbeat for 2m → treat as crashed
const CTX_WARN = 80;

type Liveness = 'active' | 'idle' | 'crashed';

function roleGlyph(session: string): string {
  const role = session.split(/[-_]/)[0]?.toLowerCase() ?? '';
  switch (role) {
    case 'frontend':
      return '🖼';
    case 'backend':
      return '⚙';
    case 'design':
      return '◇';
    case 'planner':
      return '🗺';
    case 'supervisor':
      return '🛡';
    default:
      return '⚙';
  }
}

export const WorkerPool: React.FC<WorkerPoolProps> = ({ subscriptions, todos, onJump, onSelect }) => {
  // Tick so staleness re-evaluates without a new store event.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const readyAvailable = useMemo(
    () => todos.some((t) => t.status === 'ready' && !t.claimedBy),
    [todos],
  );

  const rows = useMemo(() => {
    return subscriptions.map((sub) => {
      const stale = now - sub.lastUpdate > CRASH_MS;
      const currentTodo =
        todos.find(
          (t) =>
            (t.claimedBy === sub.session || t.assigneeSession === sub.session) &&
            (t.status === 'in_progress' || !!t.claimedBy),
        ) ?? null;

      let liveness: Liveness;
      if (stale && currentTodo) liveness = 'crashed';
      else if (sub.status === 'active') liveness = 'active';
      else liveness = 'idle';

      const ctxHigh = typeof sub.contextPercent === 'number' && sub.contextPercent >= CTX_WARN;
      const idleWithWork = liveness === 'idle' && readyAvailable && !currentTodo;

      return { sub, currentTodo, liveness, ctxHigh, idleWithWork };
    });
  }, [subscriptions, todos, now, readyAvailable]);

  const tally = useMemo(() => {
    let busy = 0;
    let idle = 0;
    let ctx = 0;
    for (const r of rows) {
      if (r.liveness === 'active' || r.currentTodo) busy += 1;
      if (r.idleWithWork) idle += 1;
      if (r.ctxHigh) ctx += 1;
    }
    return { total: rows.length, busy, idle, ctx };
  }, [rows]);

  return (
    <div data-testid="worker-pool" className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap text-2xs">
        <span className="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Workers</span>
        <span className="text-gray-500 dark:text-gray-400">
          {tally.total} · {tally.busy} busy
        </span>
        {tally.idle > 0 && (
          <span className="text-warning-600 dark:text-warning-400 font-medium">{tally.idle} idle⚠</span>
        )}
        {tally.ctx > 0 && (
          <span className="text-danger-600 dark:text-danger-400 font-medium">{tally.ctx} ⚠ctx</span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-2xs text-gray-400 dark:text-gray-500 italic">No active sessions in this project.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {rows.map(({ sub, currentTodo, liveness, ctxHigh, idleWithWork }) => {
            const tone =
              liveness === 'crashed'
                ? 'border-danger-400 dark:border-danger-600 bg-danger-50 dark:bg-danger-900/30'
                : idleWithWork
                  ? 'border-warning-400 dark:border-warning-600 bg-warning-50 dark:bg-warning-900/30'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900';
            return (
              <button
                key={`${sub.serverId}:${sub.project}:${sub.session}`}
                data-dive-id={diveLayoutId(sub.session)}
                type="button"
                onClick={() => (onSelect ? onSelect(sub.session) : onJump?.(sub.project, sub.session))}
                data-testid={`worker-card-${sub.session}`}
                title="Jump into this session's Studio"
                className={`text-left px-2 py-1.5 rounded border transition-colors hover:brightness-95 active:scale-[0.98] ${tone}`}
              >
                <div className="flex items-center gap-1.5">
                  <span aria-hidden="true">{roleGlyph(sub.session)}</span>
                  <span className="text-2xs font-medium text-gray-800 dark:text-gray-100 truncate">{sub.session}</span>
                  <span className="ml-auto text-3xs font-semibold">
                    {liveness === 'crashed' ? (
                      <span className="text-danger-600 dark:text-danger-400">✖ crashed</span>
                    ) : liveness === 'active' ? (
                      <span className="text-success-600 dark:text-success-400">● active</span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">○ idle</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-3xs text-gray-500 dark:text-gray-400 truncate flex-1">
                    {currentTodo ? currentTodo.title : idleWithWork ? 'ready work available' : '—'}
                  </span>
                  {typeof sub.contextPercent === 'number' && (
                    <span
                      className={`text-3xs font-mono tabular-nums ${
                        ctxHigh ? 'text-danger-600 dark:text-danger-400 font-bold' : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {Math.round(sub.contextPercent)}%
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
