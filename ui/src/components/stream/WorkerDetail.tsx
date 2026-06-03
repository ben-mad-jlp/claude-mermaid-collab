/**
 * WorkerDetail — a lightweight per-worker detail panel for the DrillDock
 * (Control-UI vision §6). No such panel existed; this is the minimal "open the
 * matching panel" target for a worker row/card. It reuses the same liveness and
 * role-glyph derivation as WorkerPool (inline from subscription freshness — no
 * supervisorLiveness helper) so the dock view never disagrees with the pool.
 */

import React from 'react';
import type { SessionTodo } from '@/types/sessionTodo';

interface SubLike {
  serverId: string;
  project: string;
  session: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
}

export interface WorkerDetailProps {
  session: string;
  subscriptions: SubLike[];
  todos: SessionTodo[];
  onJump?: (project: string, session: string) => void;
}

const CRASH_MS = 120_000;

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

export const WorkerDetail: React.FC<WorkerDetailProps> = ({ session, subscriptions, todos, onJump }) => {
  const sub = subscriptions.find((s) => s.session === session) ?? null;
  const ownedTodos = todos.filter(
    (t) => t.claimedBy === session || t.assigneeSession === session,
  );
  const current = ownedTodos.find((t) => t.status === 'in_progress' || !!t.claimedBy) ?? null;

  const stale = sub ? Date.now() - sub.lastUpdate > CRASH_MS : true;
  const liveness = stale && current ? 'crashed' : sub?.status === 'active' ? 'active' : 'idle';

  return (
    <div data-testid={`worker-detail-${session}`} className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden="true">{roleGlyph(session)}</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{session}</span>
        <span
          className={`ml-auto text-2xs font-semibold ${
            liveness === 'crashed'
              ? 'text-danger-600 dark:text-danger-400'
              : liveness === 'active'
                ? 'text-success-600 dark:text-success-400'
                : 'text-gray-400 dark:text-gray-500'
          }`}
        >
          {liveness === 'crashed' ? '✖ crashed' : liveness === 'active' ? '● active' : '○ idle'}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-2xs">
        <div>
          <dt className="text-gray-400 dark:text-gray-500 uppercase tracking-wide">Status</dt>
          <dd className="text-gray-700 dark:text-gray-200">{sub?.status ?? 'unknown'}</dd>
        </div>
        <div>
          <dt className="text-gray-400 dark:text-gray-500 uppercase tracking-wide">Context</dt>
          <dd className="text-gray-700 dark:text-gray-200 tabular-nums">
            {typeof sub?.contextPercent === 'number' ? `${Math.round(sub.contextPercent)}%` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400 dark:text-gray-500 uppercase tracking-wide">Todos</dt>
          <dd className="text-gray-700 dark:text-gray-200 tabular-nums">{ownedTodos.length}</dd>
        </div>
      </dl>

      <div className="space-y-1">
        <div className="text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Current
        </div>
        <div className="text-2xs text-gray-700 dark:text-gray-200">
          {current ? current.title : <span className="italic text-gray-400 dark:text-gray-500">no claimed todo</span>}
        </div>
      </div>

      {ownedTodos.length > 0 && (
        <div className="space-y-1">
          <div className="text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            All assigned
          </div>
          <ul className="space-y-0.5">
            {ownedTodos.map((t) => (
              <li key={t.id} className="text-3xs text-gray-600 dark:text-gray-300 truncate">
                · {t.title} <span className="text-gray-400 dark:text-gray-500">({t.status})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onJump && sub && (
        <button
          type="button"
          onClick={() => onJump(sub.project, session)}
          className="w-full px-2 py-1 text-2xs font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          Jump into Studio
        </button>
      )}
    </div>
  );
};

export default WorkerDetail;
