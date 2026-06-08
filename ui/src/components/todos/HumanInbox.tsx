/**
 * HumanInbox (user-todo B3) — "Your todos": the human-assigned, human-actionable
 * slice of the project work-graph, rendered as the bridge's one-card language.
 *
 * Derives entirely from the existing project todos store (no new WS events): the
 * caller passes the already project-scoped todo list, we scope to the human inbox
 * set via `selectHumanInbox`. Each row offers the work-graph transitions a person
 * drives — Claim (ready → in_progress) and Complete (in_progress → done) — plus,
 * per design Q2, a deep-link chip that opens the item in the program's native UI
 * (collab LISTS, the program RENDERS). Actions are callback props so the host
 * wires them to the supervisor store (promoteTodo / selectDocument) and the unit
 * test can assert them without a store.
 *
 * One-red discipline: the only colored accent here is the in_progress dot; ready
 * rows stay calm. Empty state is a calm tick, matching NeedsYouZone.
 */

import React from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { selectHumanInbox } from './humanInboxSelectors';

export interface HumanInboxProps {
  /** Already project-scoped todos (e.g. todosByProject[project]). */
  todos: SessionTodo[];
  /** Claim a ready human todo (ready → in_progress). */
  onClaim?: (todo: SessionTodo) => void;
  /** Complete an in-progress human todo (→ done). */
  onComplete?: (todo: SessionTodo) => void;
  /** Open the item in the program's native UI (deep-link via todo.link). */
  onOpen?: (todo: SessionTodo) => void;
  /** Render body-only (no card chrome / header) for use inside a tab panel. */
  embedded?: boolean;
}

function shortSlug(s: string): string {
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
}

export const HumanInbox: React.FC<HumanInboxProps> = ({ todos, onClaim, onComplete, onOpen, embedded }) => {
  const items = selectHumanInbox(todos);

  return (
    <div
      data-testid="human-inbox"
      data-count={items.length}
      className={embedded ? '' : 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col min-h-[8rem] max-h-56'}
    >
      {!embedded && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs">
          <span className="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Todos</span>
          <span className="text-gray-400 dark:text-gray-500">{items.length}</span>
        </div>
      )}

      <div className={embedded ? '' : 'flex-1 min-h-0 overflow-y-auto p-2'}>
      {items.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="text-success-500" aria-hidden="true">✓</span>
          <span>All clear — nothing assigned to you</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((t) => {
            const inProgress = t.status === 'in_progress';
            return (
              <li
                key={t.id}
                data-testid="human-inbox-item"
                data-todo-id={t.id}
                data-status={t.status}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    title={t.status}
                    className={`mt-1 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                      inProgress ? 'bg-info-400' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  />
                  <span className="flex-1 text-xs text-gray-800 dark:text-gray-200">{t.title}</span>
                  {t.link && (
                    <span
                      data-testid="human-inbox-open"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpen?.(t)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') onOpen?.(t);
                      }}
                      title={`Open ${t.link.blueprintId}${t.link.taskId ? ` · ${t.link.taskId}` : ''}`}
                      className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-200 max-w-[160px] truncate"
                    >
                      ↳ {shortSlug(t.link.blueprintId)}
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex items-center justify-end gap-2">
                  {t.status === 'ready' && (
                    <button
                      type="button"
                      data-testid="human-inbox-claim"
                      onClick={() => onClaim?.(t)}
                      className="px-2 py-0.5 rounded text-[11px] font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      Claim
                    </button>
                  )}
                  {inProgress && (
                    <button
                      type="button"
                      data-testid="human-inbox-complete"
                      onClick={() => onComplete?.(t)}
                      className="px-2 py-0.5 rounded text-[11px] font-medium border border-success-400 text-success-700 dark:text-success-300 hover:bg-success-50 dark:hover:bg-success-900/30"
                    >
                      Complete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </div>
  );
};

export default HumanInbox;
