import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { SessionTodo } from '@/types/sessionTodo';
import type { PlanItem } from '@/types/planItem';
import { computeWaveMap } from './roadmapToMermaid';
import { PlanKanban } from './PlanKanban';

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
}

type Mode = 'kanban' | 'list';

const STATUS_GLYPH: Record<string, string> = {
  done: '●',
  in_progress: '◐',
  blocked: '⊘',
  todo: '○',
  backlog: '◌',
};

const STATUS_COLOR: Record<string, string> = {
  done: 'text-success-600 dark:text-success-400',
  in_progress: 'text-info-600 dark:text-info-400',
  blocked: 'text-warning-600 dark:text-warning-400',
  todo: 'text-gray-500 dark:text-gray-400',
  backlog: 'text-gray-400 dark:text-gray-500',
};

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
  const colorCls = STATUS_COLOR[todo.status] ?? 'text-gray-500';
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

export const PlanPanel: React.FC<PlanPanelProps> = ({ serverId, project, onSelectTodo }) => {
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const loadProjectTodos = useSupervisorStore((s) => s.loadProjectTodos);

  const todos: SessionTodo[] = todosByProject[project] ?? [];
  const [mode, setMode] = useState<Mode>('kanban');

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
    const rows: { todo: SessionTodo; depth: number }[] = [];
    for (const top of [...topLevel].sort(sort)) {
      rows.push({ todo: top, depth: 0 });
      const kids = childrenByParent.get(top.id);
      if (kids) for (const k of [...kids].sort(sort)) rows.push({ todo: k, depth: 1 });
    }
    return rows;
  }, [todos, waveMap]);

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
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {modeButton('kanban', 'Kanban')}
          {modeButton('list', 'List')}
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
        ) : mode === 'list' ? (
          <div className="h-full overflow-auto p-2 space-y-0.5">
            {tree.map(({ todo, depth }) => (
              <PlanRow key={todo.id} todo={todo} depth={depth} onSelect={onSelectTodo} />
            ))}
          </div>
        ) : (
          <div className="h-full p-2">
            <PlanKanban todos={todos} onSelectTodo={onSelectTodo} />
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
