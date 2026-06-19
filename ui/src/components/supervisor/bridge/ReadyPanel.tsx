/**
 * ReadyPanel — the Bridge "Ready" tab. Lists the todos that are eligible to run next
 * (deps satisfied + approved + agent-assigned = isClaimable), in the SAME order the daemon
 * claims them: priority ASC (0 = highest; null/unset last), then ord (creation order). So
 * you can see "what's up next" and tell at a glance what priority is steering the queue.
 *
 * Mirrors the daemon's `byClaimPriority` comparator (coordinator-daemon.ts) so the displayed
 * order matches the real claim order. Click a row to open its detail tab. Priority is set via
 * the `update_todo` tool today (the daemon honors it); an in-row bump is a follow-up.
 */
import React, { useMemo } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { isClaimable, buildById } from '@/lib/claimability';
import { excludeEpics } from './funnel';

const PRIORITY_LABEL: Record<number, string> = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
const PRIORITY_CLASS: Record<number, string> = {
  0: 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300',
  1: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  2: 'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  3: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  4: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

/** Mirrors coordinator-daemon.byClaimPriority: priority ASC (null last), then ord. */
function byClaimPriority(a: SessionTodo, b: SessionTodo): number {
  const rank = (t: SessionTodo) => (t.priority == null ? Number.POSITIVE_INFINITY : t.priority);
  return (rank(a) - rank(b)) || ((a.order ?? 0) - (b.order ?? 0));
}

export interface ReadyPanelProps {
  todos: SessionTodo[];
  onSelectTodo?: (todo: SessionTodo) => void;
}

export const ReadyPanel: React.FC<ReadyPanelProps> = ({ todos, onSelectTodo }) => {
  const ready = useMemo(() => {
    const byId = buildById(todos);
    return excludeEpics(todos)
      .filter((t) => isClaimable(t, byId))
      .sort(byClaimPriority);
  }, [todos]);

  if (ready.length === 0) {
    return <div className="p-4 text-sm text-gray-400 dark:text-gray-500">Nothing ready — the queue is empty or everything's blocked/in-flight.</div>;
  }

  return (
    <div className="p-2 space-y-1">
      <div className="px-1 pb-1 text-3xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {ready.length} ready · claim order (priority, then created)
      </div>
      {ready.map((t, i) => {
        const p = t.priority ?? null;
        return (
          <button
            key={t.id}
            type="button"
            onClick={onSelectTodo ? () => onSelectTodo(t) : undefined}
            className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title={t.title ?? t.id}
          >
            <span className="shrink-0 w-5 text-right text-3xs text-gray-400 dark:text-gray-500 tabular-nums">{i + 1}</span>
            <span className={`shrink-0 px-1 py-0.5 rounded text-3xs font-semibold ${p == null ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' : PRIORITY_CLASS[p]}`}>
              {p == null ? '—' : PRIORITY_LABEL[p]}
            </span>
            <span className="shrink-0 font-mono text-3xs text-gray-400 dark:text-gray-500">{t.id.slice(0, 8)}</span>
            <span className="flex-1 min-w-0 truncate text-sm text-gray-800 dark:text-gray-200">{t.title ?? t.id}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ReadyPanel;
