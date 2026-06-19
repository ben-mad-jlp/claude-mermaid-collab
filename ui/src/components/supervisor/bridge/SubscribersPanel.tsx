/**
 * SubscribersPanel — the Bridge "Subscribers" tab. Lists each registered collab session
 * that has notification subscriptions, collapsible to reveal WHAT it's subscribed to
 * (a whole project, or specific epics/todos). Backed by GET /api/subscriptions?project=.
 *
 * Pairs with the session-subscriptions feature: a steward subscribes to a todo/epic/project
 * and is nudged to act; this surface answers "who's watching what."
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { apiFetch } from '@/lib/api';

interface Subscription {
  project: string;
  session: string;
  scope: 'todo' | 'epic' | 'project';
  targetId: string;
  mode: string;
  createdAt: number;
}

export interface SubscribersPanelProps {
  project: string;
  serverScope: string;
  todos: SessionTodo[];
  onSelectTodo?: (todo: SessionTodo) => void;
}

const SCOPE_CLASS: Record<string, string> = {
  project: 'bg-info-100 text-info-700 dark:bg-info-900/40 dark:text-info-300',
  epic: 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300',
  todo: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export const SubscribersPanel: React.FC<SubscribersPanelProps> = ({ project, serverScope, todos, onSelectTodo }) => {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiFetch(serverScope, `/api/subscriptions?project=${encodeURIComponent(project)}`)
        .then((r) => r.json())
        .then((j: { subscriptions?: Subscription[]; error?: string }) => {
          if (cancelled) return;
          if (j.error) { setError(j.error); return; }
          setSubs(j.subscriptions ?? []);
          setError(null);
        })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    };
    load();
    const id = setInterval(load, 5000); // subscriptions change rarely; a light poll keeps it live
    return () => { cancelled = true; clearInterval(id); };
  }, [project, serverScope]);

  const titleById = useMemo(() => new Map(todos.map((t) => [t.id, t.title ?? t.id])), [todos]);

  const bySession = useMemo(() => {
    const m = new Map<string, Subscription[]>();
    for (const s of subs) {
      const arr = m.get(s.session) ?? [];
      arr.push(s);
      m.set(s.session, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [subs]);

  if (error) return <div className="p-4 text-sm text-danger-600 dark:text-danger-400">{error}</div>;
  if (bySession.length === 0) {
    return <div className="p-4 text-sm text-gray-400 dark:text-gray-500">No subscribers. A session subscribes with the <span className="font-mono">subscribe</span> tool to be nudged about a todo, epic, or the whole project.</div>;
  }

  return (
    <div className="p-2 space-y-1">
      {bySession.map(([session, list]) => {
        const open = expanded.has(session);
        return (
          <div key={session} className="rounded border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setExpanded((prev) => { const n = new Set(prev); n.has(session) ? n.delete(session) : n.add(session); return n; })}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            >
              <span className="shrink-0 text-gray-400 text-2xs">{open ? '▾' : '▸'}</span>
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{session}</span>
              <span className="shrink-0 text-3xs text-gray-400 dark:text-gray-500">{list.length} sub{list.length === 1 ? '' : 's'}</span>
            </button>
            {open && (
              <div className="px-2 pb-1.5 space-y-0.5">
                {list.map((s) => {
                  const todo = s.scope !== 'project' ? todos.find((t) => t.id === s.targetId) : undefined;
                  const label = s.scope === 'project' ? 'whole project' : (titleById.get(s.targetId) ?? s.targetId.slice(0, 8));
                  return (
                    <button
                      key={`${s.scope}:${s.targetId}`}
                      type="button"
                      onClick={todo && onSelectTodo ? () => onSelectTodo(todo) : undefined}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left ${todo ? 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer' : 'cursor-default'}`}
                      title={s.scope === 'project' ? project : s.targetId}
                    >
                      <span className={`shrink-0 px-1 py-0.5 rounded text-3xs font-semibold uppercase ${SCOPE_CLASS[s.scope]}`}>{s.scope}</span>
                      <span className="flex-1 min-w-0 truncate text-2xs text-gray-700 dark:text-gray-300">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SubscribersPanel;
