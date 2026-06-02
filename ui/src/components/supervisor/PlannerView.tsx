import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { PlanPanel } from './PlanPanel';
import { RoleSwitcher } from './RoleSwitcher';

/**
 * PCS Phase 5 — Planner view. Plans the project roadmap as unified work-graph
 * todos and is the SOLE promoter of plan items to `ready` (plan-level approval);
 * the Coordinator never self-promotes. Read/visualize via the shared PlanPanel,
 * plus a promotion strip that moves not-yet-ready items to `ready`.
 */

// Statuses that are eligible for the Planner to promote to `ready`.
const PROMOTABLE = new Set(['backlog', 'todo', 'planned']);

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

export const PlannerView: React.FC = () => {
  const activeId = useSessionStore((s) => s.currentSession)?.serverId ?? null;
  const serverScope = activeId ?? 'local';
  const currentSession = useSessionStore((s) => s.currentSession);

  const config = useSupervisorStore((s) => s.config);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);
  const promoteTodo = useSupervisorStore((s) => s.promoteTodo);
  const activeProjectPref = useUIStore((s) => s.activeProject);

  const project = activeProjectPref ?? currentSession?.project ?? config?.supervisorProject ?? '';

  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    void loadConfigIfNeeded();
    if (serverScope && project) void loadProjectTodos(serverScope, project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverScope, project]);

  const loadConfigIfNeeded = async () => {
    if (!config) await useSupervisorStore.getState().loadConfig(serverScope);
  };

  const todos = todosByProject[project] ?? [];
  const awaiting = useMemo(() => todos.filter((t) => PROMOTABLE.has(t.status)), [todos]);
  const readyCount = todos.filter((t) => t.status === 'ready').length;

  const approvePlan = async () => {
    if (!project || awaiting.length === 0) return;
    setPromoting(true);
    try {
      // Promote each eligible item; promoteTodo re-fetches the plan each time,
      // so do them sequentially to keep the store consistent.
      for (const t of awaiting) {
        await promoteTodo(serverScope, project, t.id, 'ready');
      }
    } finally {
      setPromoting(false);
    }
  };

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
        <span className="text-base" role="img" aria-label="planner">🧭</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Planner</span>
        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-[200px]">
          {projectBasename(project)}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {todos.length} items · {readyCount} ready
          </span>
          <RoleSwitcher />
        </div>
      </div>

      {/* Promotion strip — plan-level approval */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
        <span className="text-xs text-gray-600 dark:text-gray-300">
          {awaiting.length === 0
            ? 'All plan items promoted — nothing awaiting approval.'
            : `${awaiting.length} item${awaiting.length === 1 ? '' : 's'} awaiting promotion to ready`}
        </span>
        <button
          type="button"
          onClick={approvePlan}
          disabled={promoting || awaiting.length === 0}
          className="ml-auto px-3 py-1 text-xs rounded-md bg-accent-600 text-white font-medium hover:bg-accent-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {promoting ? 'Promoting…' : 'Approve plan → ready'}
        </button>
      </div>

      {/* Plan */}
      <div className="flex-1 overflow-hidden min-h-0 p-3">
        <PlanPanel serverId={serverScope} project={project} />
      </div>
    </div>
  );
};

export default PlannerView;
