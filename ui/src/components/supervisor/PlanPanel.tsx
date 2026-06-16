import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { SessionTodo } from '@/types/sessionTodo';
import type { PlanItem } from '@/types/planItem';
import { computeWaveMap } from './roadmapToMermaid';
import { PlanKanban } from './PlanKanban';
import { FleetGraph } from './bridge/fleet/FleetGraph';
import { bucketTodo, STATUS_STYLE } from './bridge/funnel';

/**
 * PCS Phase 5 / Bridge P6 — the project Plan, backed by the UNIFIED work-graph
 * todos (todosByProject). The primary view is the flex/grid PlanKanban (wave
 * columns + Ready-Now lane + progress + bottleneck tags); the mermaid graph/waves
 * render path is gone. `List` is kept as a dense, epic-grouped fallback.
 */
export interface PlanPanelProps {
  serverId: string;
  project: string;
  /**
   * Optional: clicking a plan item (kanban card or a list row) selects the
   * underlying todo. Used by the Plan workspace to open a TodoDetailView.
   */
  onSelectTodo?: (todo: SessionTodo) => void;
  /**
   * Optional: clicking an epic node in the FleetGraph surfaces the epic's
   * escalation + decision history (EpicHistoryView) in the Bridge.
   */
  onSelectEpic?: (epic: { id: string; label: string }) => void;
}

type Mode = 'kanban' | 'list' | 'graph';

const STATUS_GLYPH: Record<string, string> = {
  done: '●',
  in_progress: '◐',
  blocked: '⊘',
  todo: '○',
  backlog: '◌',
};

/** Glyph tint sourced from the canonical funnel palette (bucket → tint). */
function statusTint(todo: SessionTodo): string {
  const key = bucketTodo(todo);
  return key ? STATUS_STYLE[key].tint : 'text-gray-500 dark:text-gray-400';
}

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

/**
 * Sort comparator for the sidebar Plan: in_progress pinned on top, then by
 * dependency wave (phase) ascending, then creation order; completed grouped at
 * the bottom. (Same shape we manually applied to the session todos.)
 */
function planSort(waveMap: Map<string, number>) {
  const rank = (t: SessionTodo): number => {
    if (t.status === 'in_progress') return 0;
    if (t.status === 'done') return 2;
    return 1;
  };
  return (a: SessionTodo, b: SessionTodo): number => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const wa = waveMap.get(a.id) ?? 0;
    const wb = waveMap.get(b.id) ?? 0;
    if (wa !== wb) return wa - wb;
    return (a.order ?? 0) - (b.order ?? 0);
  };
}

function PlanRow({
  todo,
  depth,
  onSelect,
}: {
  todo: SessionTodo;
  depth: number;
  onSelect?: (todo: SessionTodo) => void;
}) {
  const glyph = STATUS_GLYPH[todo.status] ?? '○';
  const colorCls = statusTint(todo);
  const depCount = todo.dependsOn?.length ?? 0;
  const isInProgress = todo.status === 'in_progress';
  return (
    <div
      onClick={onSelect ? () => onSelect(todo) : undefined}
      className={`flex items-start gap-2 py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 ${
        onSelect ? 'cursor-pointer' : ''
      } ${isInProgress ? 'bg-info-50 dark:bg-info-900/20' : ''}`}
      style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
    >
      <span className={`mt-0.5 text-xs font-mono select-none ${colorCls}`} title={todo.status}>
        {glyph}
      </span>
      <span className="flex-1 text-xs text-gray-800 dark:text-gray-200 leading-tight">
        {todo.title}
      </span>
      {depCount > 0 && (
        <span
          className="shrink-0 text-3xs text-gray-400 dark:text-gray-500 font-mono"
          title={`${depCount} dependenc${depCount === 1 ? 'y' : 'ies'}`}
        >
          ⊸{depCount}
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

export const PlanPanel: React.FC<PlanPanelProps> = ({ serverId, project, onSelectTodo, onSelectEpic }) => {
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);

  const todos: SessionTodo[] = todosByProject[project] ?? [];
  const [mode, setMode] = useState<Mode>('kanban');
  const [graphEpicId, setGraphEpicId] = useState<string | null>(null);
  // Graph mode: the epic list is a collapsible LEFT rail (was a top tab bar).
  const [graphListCollapsed, setGraphListCollapsed] = useState(false);
  // Shared across Kanban / List / Graph — when off, completed (done/dropped)
  // todos and fully-completed epics are hidden everywhere, including graph tabs.
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (serverId && project) {
      loadProjectTodos(serverId, project);
    }
  }, [serverId, project, loadProjectTodos]);

  const waveMap = useMemo(() => computeWaveMap(todos as PlanItem[]), [todos]);

  const inProgress = todos.filter((t) => t.status === 'in_progress').length;
  const blocked = todos.filter((t) => t.status === 'blocked').length;

  // Epic-grouped, sorted tree for list mode: top-level items (no parent in set)
  // sorted by the plan order, each followed by its children (also sorted).
  const tree = useMemo(() => {
    const sort = planSort(waveMap);
    const byId = new Map(todos.map((t) => [t.id, t]));
    const childrenByParent = new Map<string, SessionTodo[]>();
    const topLevel: SessionTodo[] = [];
    for (const t of todos) {
      if (t.parentId && byId.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) ?? [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      } else {
        topLevel.push(t);
      }
    }
    const TERMINAL = new Set(['done', 'dropped']);
    const keep = (t: SessionTodo) => showCompleted || !TERMINAL.has(t.status);
    const rows: { todo: SessionTodo; depth: number }[] = [];
    for (const top of [...topLevel].sort(sort)) {
      const kids = (childrenByParent.get(top.id) ?? []).filter(keep);
      // Drop a fully-completed epic (itself terminal AND no surviving children).
      if (!keep(top) && kids.length === 0) continue;
      rows.push({ todo: top, depth: 0 });
      for (const k of [...kids].sort(sort)) rows.push({ todo: k, depth: 1 });
    }
    return rows;
  }, [todos, waveMap, showCompleted]);

  // Graph mode: one graph PER EPIC (top-level item + its full descendant subtree),
  // stacked in rows — instead of a single combined fleet graph. Only top-level
  // items that actually have descendants are graphed (a lone leaf has nothing to show).
  const epicGraphs = useMemo(() => {
    const byId = new Map(todos.map((t) => [t.id, t]));
    const childrenByParent = new Map<string, SessionTodo[]>();
    const topLevel: SessionTodo[] = [];
    for (const t of todos) {
      if (t.parentId && byId.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) ?? [];
        arr.push(t);
        childrenByParent.set(t.parentId, arr);
      } else {
        topLevel.push(t);
      }
    }
    const descendants = (rootId: string): SessionTodo[] => {
      const out: SessionTodo[] = [];
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop()!;
        for (const k of childrenByParent.get(id) ?? []) { out.push(k); stack.push(k.id); }
      }
      return out;
    };
    const sort = planSort(waveMap);
    const TERMINAL = new Set(['done', 'dropped']);
    return [...topLevel]
      .sort(sort)
      .map((epic) => {
        const full = [epic, ...descendants(epic.id)];
        // Honor "Show completed": when off, drop terminal todos; a fully-completed
        // epic then collapses to <2 nodes and is filtered out below (no tab).
        const visible = showCompleted ? full : full.filter((t) => !TERMINAL.has(t.status));
        return { epic, todos: visible };
      })
      .filter((g) => g.todos.length > 1);
  }, [todos, waveMap, showCompleted]);

  const modeButton = (m: Mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => setMode(m)}
      className={`px-2 py-0.5 text-xs rounded transition-colors ${
        mode === m
          ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Plan
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
            · {projectBasename(project)}
          </span>
          <button
            type="button"
            data-testid="plan-refresh"
            title="Refresh plan"
            aria-label="Refresh plan"
            onClick={() => { if (serverId && project) void loadProjectTodos(serverId, project); }}
            className="p-1 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label
            className="flex items-center gap-1 text-3xs text-gray-500 dark:text-gray-400 cursor-pointer select-none"
            title="Show completed todos and fully-completed epics (Kanban, List, and Graph)"
          >
            <input
              type="checkbox"
              data-testid="plan-show-completed"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="h-3 w-3"
            />
            Show completed
          </label>
          <span className="h-4 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
          <div className="flex items-center gap-0.5">
            {modeButton('kanban', 'Kanban')}
            {modeButton('list', 'List')}
            {modeButton('graph', 'Graph')}
          </div>
        </div>
      </div>

      {/* Body — wave-kanban (primary) or the dense epic-grouped list fallback. */}
      <div className="flex-1 overflow-hidden min-h-0">
        {todos.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              No plan items for this project.
            </p>
          </div>
        ) : mode === 'graph' ? (
          epicGraphs.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-gray-400 dark:text-gray-500">No epics with sub-tasks to graph.</p>
            </div>
          ) : (() => {
            const active = epicGraphs.find((g) => g.epic.id === graphEpicId) ?? epicGraphs[0];
            return (
              <div className="flex h-full min-h-0">
                {/* Epic list — a collapsible LEFT rail (one row per epic). */}
                {graphListCollapsed ? (
                  <div className="shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center py-1">
                    <button
                      type="button"
                      onClick={() => setGraphListCollapsed(false)}
                      title="Show epics"
                      aria-label="Show epics"
                      className="p-1 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                    </button>
                  </div>
                ) : (
                  <div className="shrink-0 w-44 border-r border-gray-200 dark:border-gray-700 flex flex-col min-h-0">
                    <div className="shrink-0 flex items-center justify-between px-2 py-1 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Epics</span>
                      <button
                        type="button"
                        onClick={() => setGraphListCollapsed(true)}
                        title="Collapse epics"
                        aria-label="Collapse epics"
                        className="p-0.5 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto p-1 space-y-0.5">
                      {epicGraphs.map((g) => (
                        <button
                          key={g.epic.id}
                          type="button"
                          onClick={() => setGraphEpicId(g.epic.id)}
                          title={g.epic.title ?? g.epic.text}
                          className={`w-full text-left truncate px-2 py-1 text-2xs rounded transition-colors ${
                            active.epic.id === g.epic.id
                              ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 font-semibold'
                              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          {(g.epic.title ?? g.epic.text ?? '').replace(/^\[EPIC\]\s*/i, '')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  <FleetGraph todos={active.todos} subs={[]} onSelectTodo={onSelectTodo} onSelectEpic={onSelectEpic} />
                </div>
              </div>
            );
          })()
        ) : mode === 'list' ? (
          <div className="h-full overflow-auto p-2 space-y-0.5">
            {tree.map(({ todo, depth }) => (
              <PlanRow key={todo.id} todo={todo} depth={depth} onSelect={onSelectTodo} />
            ))}
          </div>
        ) : (
          <div className="h-full p-2">
            <PlanKanban todos={todos} onSelectTodo={onSelectTodo} showCompleted={showCompleted} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
        {todos.length} items · {inProgress} in progress · {blocked} blocked
      </div>
    </div>
  );
};

export default PlanPanel;
