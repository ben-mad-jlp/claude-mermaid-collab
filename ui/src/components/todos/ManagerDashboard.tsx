import { useMemo } from 'react';
import type { SessionTodo, TodoStatus } from '@/types/sessionTodo';
import { groupByAssignee, statusCounts } from '@/lib/todoGrouping';

const STATUS_DOT: Record<TodoStatus, string> = {
  backlog: 'bg-gray-400',
  planned: 'bg-gray-300',
  todo: 'bg-blue-400',
  ready: 'bg-indigo-400',
  in_progress: 'bg-yellow-400',
  blocked: 'bg-red-400',
  done: 'bg-green-400',
  dropped: 'bg-gray-300',
};

/**
 * Manager view (Phase 1, modest): the current session's OWNED todos grouped by
 * assignee, with a per-group status summary. Read-only overview — assignment +
 * status changes happen on the rows in the main todo list. Full Kanban deferred.
 */
export function ManagerDashboard({ todos, me }: { todos: SessionTodo[]; me: string }) {
  const owned = useMemo(() => todos.filter((t) => t.ownerSession === me), [todos, me]);
  const groups = useMemo(() => groupByAssignee(owned), [owned]);

  if (owned.length === 0) {
    return <div className="px-2 py-2 text-xs text-gray-400 dark:text-gray-500">No todos you own yet.</div>;
  }

  return (
    <div className="px-1 py-1 text-xs">
      {groups.map((group) => {
        const counts = statusCounts(group.todos);
        return (
          <div key={group.assignee} className="mb-2">
            <div className="flex items-center gap-2 px-1 py-0.5 font-semibold text-gray-600 dark:text-gray-300">
              <span className="truncate">{group.assignee}</span>
              <span className="text-gray-400 dark:text-gray-500">({group.todos.length})</span>
              <span className="flex items-center gap-1">
                {(Object.entries(counts) as [TodoStatus, number][]).map(([s, n]) => (
                  <span key={s} title={`${s}: ${n}`} className="inline-flex items-center gap-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s]}`} />
                    {n}
                  </span>
                ))}
              </span>
            </div>
            <ul className="pl-3">
              {group.todos.map((t) => (
                <li key={t.id} className={`truncate py-0.5 ${t.status === 'done' || t.completed ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${STATUS_DOT[t.status ?? (t.completed ? 'done' : 'todo')]}`} />
                  {t.title ?? t.text ?? ''}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
