import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import type { SessionTodo } from '@/types/sessionTodo';
import { PlanPanel } from './PlanPanel';
import TodoDetailView from '@/components/editors/TodoDetailView';

/**
 * PlanWorkspace — the PLAN mode surface (Control-UI vision §4).
 *
 * Thin compose, replacing the CUI-1 stub: the project Plan graph/waves/list at
 * center (REUSE PlanPanel → roadmapToMermaid/computeWaveMap), the
 * "Approve plan → ready" PromotionStrip docked top (REUSE the PlannerView strip)
 * as the ONLY Planner affordance — an action, not a role — and a roadmap node
 * click → TodoDetailView in a right-hand dock. Scoped by `activeProject`
 * (the Bridge/Plan project selector), falling back to the current session's
 * project so the workspace is never empty mid-session.
 */

// Statuses eligible for the Planner to promote to `ready` (mirrors PlannerView).
const PROMOTABLE = new Set(['backlog', 'todo', 'planned']);

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

export const PlanWorkspace: React.FC = () => {
  const currentSession = useSessionStore((s) => s.currentSession);
  const upsertSessionTodo = useSessionStore((s) => s.upsertSessionTodo);
  const serverScope = currentSession?.serverId ?? 'local';

  const config = useSupervisorStore((s) => s.config);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);
  const loadConfig = useSupervisorStore((s) => s.loadConfig);
  const promoteTodo = useSupervisorStore((s) => s.promoteTodo);
  const activeProjectPref = useUIStore((s) => s.activeProject);

  const project = activeProjectPref ?? currentSession?.project ?? config?.supervisorProject ?? '';

  const [promoting, setPromoting] = useState(false);
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);

  useEffect(() => {
    if (!config) void loadConfig(serverScope);
    if (serverScope && project) void loadProjectTodos(serverScope, project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverScope, project]);

  const todos = todosByProject[project] ?? [];
  const awaiting = useMemo(() => todos.filter((t) => PROMOTABLE.has(t.status)), [todos]);
  const readyCount = todos.filter((t) => t.status === 'ready').length;

  const approvePlan = async () => {
    if (!project || awaiting.length === 0) return;
    setPromoting(true);
    try {
      // promoteTodo re-fetches the plan each time, so promote sequentially to
      // keep the store consistent (same as the PlannerView strip).
      for (const t of awaiting) {
        await promoteTodo(serverScope, project, t.id, 'ready');
      }
    } finally {
      setPromoting(false);
    }
  };

  // Node/row click → seed the session store so TodoDetailView (which reads from
  // sessionStore) can render this project todo, then open it in the dock. Same
  // seeding pattern the legacy ProjectScopeSection used for plan rows.
  const selectTodo = (todo: SessionTodo) => {
    upsertSessionTodo(todo);
    setSelectedTodoId(todo.id);
  };

  if (!project) {
    return (
      <main className="flex-1 h-full min-h-0 overflow-hidden bg-white dark:bg-gray-800 flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="text-2xl mb-2" aria-hidden="true">◑</div>
          <div className="text-sm font-medium">Plan</div>
          <div className="text-xs mt-1">No project in scope. Open a session or pick a project.</div>
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid="plan-workspace"
      className="flex-1 h-full min-h-0 overflow-hidden bg-white dark:bg-gray-900 flex flex-col"
    >
      {/* Promotion strip — plan-level approval (the only Planner affordance). */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
        <span className="text-base" role="img" aria-label="plan">🧭</span>
        <span className="text-xs text-gray-600 dark:text-gray-300">
          <span className="font-medium text-gray-700 dark:text-gray-200">{projectBasename(project)}</span>
          {' · '}
          {awaiting.length === 0
            ? `${readyCount} ready — nothing awaiting approval`
            : `${awaiting.length} item${awaiting.length === 1 ? '' : 's'} awaiting promotion to ready`}
        </span>
        <button
          type="button"
          data-testid="plan-approve"
          onClick={approvePlan}
          disabled={promoting || awaiting.length === 0}
          className="ml-auto px-3 py-1 text-xs rounded-md bg-accent-600 text-white font-medium hover:bg-accent-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {promoting ? 'Promoting…' : 'Approve plan → ready'}
        </button>
      </div>

      {/* Center plan + right-hand detail dock. */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-hidden p-3">
          <PlanPanel serverId={serverScope} project={project} onSelectTodo={selectTodo} />
        </div>
        {selectedTodoId && (
          <aside
            data-testid="plan-detail-dock"
            className="w-[28rem] max-w-[45%] shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col min-h-0"
          >
            <div className="shrink-0 flex items-center justify-end px-2 py-1 border-b border-gray-200 dark:border-gray-700">
              <button
                type="button"
                aria-label="Close detail"
                onClick={() => setSelectedTodoId(null)}
                className="px-2 py-0.5 text-xs rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <TodoDetailView todoId={selectedTodoId} />
            </div>
          </aside>
        )}
      </div>
    </main>
  );
};

export default PlanWorkspace;
