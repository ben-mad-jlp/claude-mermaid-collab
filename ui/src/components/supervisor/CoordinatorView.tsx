import React, { useEffect, useMemo } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import type { SessionTodo } from '@/types/sessionTodo';
import { RoleSwitcher } from './RoleSwitcher';

/**
 * PCS Phase 5 — Coordinator view. Surfaces the per-project Coordinator daemon
 * (the deterministic control loop that claims ready todos and spawns workers)
 * plus the live work-graph bucketed into lanes: Ready → In-flight → Blocked →
 * Done, with the Backlog (not yet promoted) shown last.
 */

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

const LANES: { key: string; label: string; match: (t: SessionTodo) => boolean; tint: string }[] = [
  { key: 'ready', label: 'Ready', match: (t) => t.status === 'ready', tint: 'text-gray-600 dark:text-gray-300' },
  {
    key: 'inflight',
    label: 'In-flight',
    match: (t) => t.status === 'in_progress' || !!t.claimedBy,
    tint: 'text-info-600 dark:text-info-400',
  },
  { key: 'blocked', label: 'Blocked', match: (t) => t.status === 'blocked', tint: 'text-warning-600 dark:text-warning-400' },
  { key: 'done', label: 'Done', match: (t) => t.status === 'done', tint: 'text-success-600 dark:text-success-400' },
];

function TodoChip({ todo }: { todo: SessionTodo }) {
  return (
    <div className="flex items-start gap-2 py-1 px-2 rounded border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
      <span className="flex-1 text-xs text-gray-800 dark:text-gray-200 leading-tight">{todo.title}</span>
      {todo.claimedBy && (
        <span className="shrink-0 text-3xs font-mono text-info-500 dark:text-info-400" title={`claimed by ${todo.claimedBy}`}>
          ⚑{todo.claimedBy.slice(0, 8)}
        </span>
      )}
      {todo.assigneeSession && (
        <span className="shrink-0 text-3xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
          {todo.assigneeSession}
        </span>
      )}
    </div>
  );
}

export const CoordinatorView: React.FC = () => {
  const activeId = useSessionStore((s) => s.currentSession)?.serverId ?? null;
  const serverScope = activeId ?? 'local';
  const currentSession = useSessionStore((s) => s.currentSession);

  const config = useSupervisorStore((s) => s.config);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
  const setCoordinator = useSupervisorStore((s) => s.setCoordinator);
  const activeProjectPref = useUIStore((s) => s.activeProject);

  const project = activeProjectPref ?? currentSession?.project ?? config?.supervisorProject ?? '';
  const running = !!coordinatorByProject[project];

  useEffect(() => {
    if (!config) void useSupervisorStore.getState().loadConfig(serverScope);
    if (serverScope && project) {
      void loadProjectTodos(serverScope, project);
      void loadCoordinator(serverScope, project);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverScope, project]);

  const todos = todosByProject[project] ?? [];
  const lanes = useMemo(() => LANES.map((l) => ({ ...l, items: todos.filter(l.match) })), [todos]);
  const backlog = useMemo(
    () => todos.filter((t) => !LANES.some((l) => l.match(t))),
    [todos],
  );

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
        No project in scope. Open a session or pick a project.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
      {/* Identity bar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
        <span className="text-base" role="img" aria-label="coordinator">⚙</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Coordinator</span>
        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-[200px]">
          {projectBasename(project)}
        </span>
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${running ? 'bg-success-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          title={running ? 'Daemon running' : 'Daemon stopped'}
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">{running ? 'running' : 'stopped'}</span>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => void setCoordinator(serverScope, project, running ? 'stop' : 'start')}
            className="px-3 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {running ? 'Stop daemon' : 'Start daemon'}
          </button>
          <RoleSwitcher />
        </div>
      </div>

      {/* Lanes */}
      <div className="flex-1 overflow-auto min-h-0 p-3 grid grid-cols-1 lg:grid-cols-4 gap-3">
        {lanes.map((lane) => (
          <div key={lane.key} className="flex flex-col min-h-0">
            <div className={`shrink-0 flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide ${lane.tint}`}>
              {lane.label}
              <span className="text-gray-400 dark:text-gray-500 font-normal">{lane.items.length}</span>
            </div>
            <div className="space-y-1.5">
              {lane.items.length === 0 ? (
                <p className="text-xs text-gray-300 dark:text-gray-600 italic">—</p>
              ) : (
                lane.items.map((t) => <TodoChip key={t.id} todo={t} />)
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Backlog footer */}
      <div className="shrink-0 px-4 py-1.5 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
        {backlog.length} in backlog (not yet promoted) · {todos.length} total
      </div>
    </div>
  );
};

export default CoordinatorView;
