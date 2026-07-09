/**
 * StrandedPanel — the Bridge surface that stops collapsing every non-runnable leaf into
 * one "blocked" bucket. Two dependency-gated states look identical there today, but they
 * are NOT the same:
 *
 *   - a leaf whose dep is still RUNNING (`deps-pending`) recovers by WAITING — no human;
 *   - a leaf whose dep was DROPPED (`dep-dropped`) is PERMANENTLY unsatisfiable — it
 *     recovers only by a human re-pointing the edge, `reset_todo`-ing the dep, or
 *     dropping the leaf.
 *
 * This panel renders the two as structurally distinct sections so the difference is
 * visible at a glance, not just in a tooltip.
 */
import React, { useMemo } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { claimReason, depDropped, buildById } from '@/lib/claimability';
import { excludeEpics } from './funnel';

export interface StrandedPanelProps {
  todos: SessionTodo[];
  onSelectTodo?: (todo: SessionTodo) => void;
}

interface StrandedEntry {
  todo: SessionTodo;
  deadDeps: SessionTodo[];
}

export const StrandedPanel: React.FC<StrandedPanelProps> = ({ todos, onSelectTodo }) => {
  const { stranded, waiting } = useMemo(() => {
    const byId = buildById(todos);
    const stranded: StrandedEntry[] = [];
    const waiting: SessionTodo[] = [];
    for (const t of excludeEpics(todos)) {
      const reason = claimReason(t, byId);
      if (reason === 'dep-dropped') {
        stranded.push({
          todo: t,
          // depDropped names WHICH deps are dead; it does not re-decide the reason.
          deadDeps: (t.dependsOn ?? [])
            .map((id) => byId.get(id))
            .filter((d): d is SessionTodo => depDropped(d)),
        });
      } else if (reason === 'deps-pending') {
        waiting.push(t);
      }
    }
    stranded.sort((a, b) => (a.todo.order ?? 0) - (b.todo.order ?? 0));
    waiting.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return { stranded, waiting };
  }, [todos]);

  if (stranded.length === 0 && waiting.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 dark:text-gray-500">
        Nothing stranded — no leaf is waiting on dropped or pending work.
      </div>
    );
  }

  return (
    <div className="p-2 space-y-3">
      {stranded.length > 0 && (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-3xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {stranded.length} stranded · a dropped dependency can never be satisfied
          </div>
          {stranded.map(({ todo: t, deadDeps }) => (
            <button
              key={t.id}
              type="button"
              onClick={onSelectTodo ? () => onSelectTodo(t) : undefined}
              className="w-full text-left flex flex-col gap-1 px-2 py-1.5 rounded border-l-2 border-warning-500 bg-warning-50 dark:bg-warning-900/20 transition-colors"
              title={t.title ?? t.id}
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0 px-1 py-0.5 rounded text-3xs font-semibold uppercase tracking-wide bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300">
                  STRANDED
                </span>
                <span className="shrink-0 font-mono text-3xs text-gray-400 dark:text-gray-500">{t.id.slice(0, 8)}</span>
                <span className="flex-1 min-w-0 truncate text-sm text-gray-800 dark:text-gray-200">{t.title ?? t.id}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1 pl-1">
                {deadDeps.length > 0 ? (
                  deadDeps.map((dep) => (
                    <span
                      key={dep.id}
                      title={dep.title}
                      className="px-1 py-0.5 rounded text-3xs font-mono line-through bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300"
                    >
                      {dep.id.slice(0, 8)}
                    </span>
                  ))
                ) : (
                  <span className="px-1 py-0.5 rounded text-3xs font-mono line-through bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300">
                    unknown dep
                  </span>
                )}
              </div>
              <div className="pl-1 text-3xs text-gray-400 dark:text-gray-500">
                Needs a human — re-point the edge, reset the dep, or drop this todo.
              </div>
            </button>
          ))}
        </div>
      )}
      {waiting.length > 0 && (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-3xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {waiting.length} waiting on live work · no action needed
          </div>
          {waiting.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={onSelectTodo ? () => onSelectTodo(t) : undefined}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={t.title ?? t.id}
            >
              <span className="shrink-0 font-mono text-3xs text-gray-400 dark:text-gray-500">{t.id.slice(0, 8)}</span>
              <span className="flex-1 min-w-0 truncate text-sm text-gray-800 dark:text-gray-200">{t.title ?? t.id}</span>
              <span className="shrink-0 px-1 py-0.5 rounded text-3xs bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                waiting on {(t.dependsOn ?? []).length}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default StrandedPanel;
