/**
 * WorkerRoster — the worker list (BR-2, design §2/§8).
 *
 * Reflows WorkerPool's cramped card grid into a clean single-column list: a
 * liveness dot, the worker name, its current-todo title, and a context
 * micro-gauge. Liveness comes from the shared `deriveLiveness` so the roster and
 * future FleetGraph nodes never disagree. Clicking a row dives into that
 * session's Studio.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import {
  currentTodoFor,
  deriveLiveness,
  isContextHot,
  roleGlyph,
  type Liveness,
} from '@/lib/liveness';

interface SubLike {
  serverId: string;
  project: string;
  session: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
}

export interface WorkerRosterProps {
  subscriptions: SubLike[];
  todos: SessionTodo[];
  onJump?: (project: string, session: string) => void;
}

/** Dot color by real session status (matches the left-tree SessionCard palette):
 *  permission = red (needs you), active = amber (working), waiting = green
 *  (ready/idle-waiting), unknown = grey. A confirmed-crashed worker is red. */
function statusDot(status: SubLike['status'], crashed: boolean): string {
  if (crashed) return 'bg-danger-500';
  switch (status) {
    case 'permission':
      return 'bg-danger-500';
    case 'active':
      return 'bg-warning-500';
    case 'waiting':
      return 'bg-success-500';
    default:
      return 'bg-gray-300 dark:bg-gray-600';
  }
}

/** Fallback row text when the worker holds no current todo. */
function statusLabel(status: SubLike['status']): string {
  switch (status) {
    case 'permission':
      return 'needs permission';
    case 'active':
      return 'working';
    case 'waiting':
      return 'waiting';
    default:
      return 'idle';
  }
}

export const WorkerRoster: React.FC<WorkerRosterProps> = ({ subscriptions, todos, onJump }) => {
  // Tick so staleness re-evaluates without a fresh store event.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    return subscriptions.map((sub) => {
      const currentTodo = currentTodoFor(sub.session, todos);
      const liveness = deriveLiveness(sub, currentTodo, now);
      return { sub, currentTodo, liveness, ctxHot: isContextHot(sub.contextPercent) };
    });
  }, [subscriptions, todos, now]);

  return (
    <div
      data-testid="worker-roster"
      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col min-h-[8rem] max-h-56"
    >
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs">
        <span className="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Workers</span>
        <span className="text-gray-400 dark:text-gray-500">{rows.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 italic">No active sessions in this project.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(({ sub, currentTodo, liveness, ctxHot }) => (
            <li key={`${sub.serverId}:${sub.project}:${sub.session}`}>
              <button
                type="button"
                onClick={() => onJump?.(sub.project, sub.session)}
                data-testid={`roster-row-${sub.session}`}
                title="Dive into this session's Studio"
                className="w-full flex items-start gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
              >
                <span className={`shrink-0 mt-1 w-2 h-2 rounded-full ${statusDot(sub.status, liveness === 'crashed')}`} aria-hidden="true" />
                <span className="shrink-0" aria-hidden="true">{roleGlyph(sub.session)}</span>
                <span className="shrink-0 font-medium text-gray-800 dark:text-gray-100 truncate max-w-[7rem]">
                  {sub.session}
                </span>
                <span className="flex-1 min-w-0 text-gray-500 dark:text-gray-400 line-clamp-2 leading-snug">
                  {currentTodo ? currentTodo.title : liveness === 'crashed' ? 'unresponsive' : statusLabel(sub.status)}
                </span>
                {typeof sub.contextPercent === 'number' && (
                  <span className="shrink-0 flex items-center gap-1">
                    <span className="w-10 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      <span
                        className={`block h-full ${ctxHot ? 'bg-danger-500' : 'bg-gray-400 dark:bg-gray-500'}`}
                        style={{ width: `${Math.min(100, Math.max(0, sub.contextPercent))}%` }}
                      />
                    </span>
                    <span className={`tabular-nums ${ctxHot ? 'text-danger-600 dark:text-danger-400 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                      {Math.round(sub.contextPercent)}%
                    </span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
};

export default WorkerRoster;
