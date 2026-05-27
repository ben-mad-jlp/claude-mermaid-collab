import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';
import { ConfirmClearCompletedDialog } from '@/components/dialogs/ConfirmClearCompletedDialog';
import { SessionTodo, TodoStatus } from '@/types/sessionTodo';
import { SectionBranchRow } from './TreeBranchRow';

function shortSlug(blueprintId: string): string {
  const m = blueprintId.match(/^(?:Implementing|Archive)\/(?:[^/]+\/)?(.+)$/);
  return m ? m[1] : blueprintId;
}

const STATUS_ORDER: TodoStatus[] = ['backlog', 'todo', 'in_progress', 'blocked', 'done'];

const STATUS_LABEL: Record<TodoStatus, string> = {
  backlog: 'BL',
  todo: 'TD',
  in_progress: 'IP',
  blocked: 'BK',
  done: 'DN',
};

const STATUS_COLORS: Record<TodoStatus, string> = {
  backlog: 'text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800',
  todo: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
  in_progress: 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30',
  blocked: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30',
  done: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30',
};

const PRIORITY_LABEL: Record<number, string> = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
const PRIORITY_COLORS: Record<number, string> = {
  0: 'text-red-600 dark:text-red-400',
  1: 'text-orange-500 dark:text-orange-400',
  2: 'text-yellow-600 dark:text-yellow-400',
  3: 'text-blue-500 dark:text-blue-400',
  4: 'text-gray-400 dark:text-gray-500',
};

export interface SessionTodosSectionHandle {
  revealAddInput: () => void;
}

export interface SessionTodosSectionProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export type { SessionTodosSectionProps as TodosTreeSectionProps };

interface TodoRowProps {
  todo: SessionTodo;
  project: string;
  session: string;
}

function TodoRow({ todo, project, session }: TodoRowProps) {
  const upsertSessionTodo = useSessionStore((s) => s.upsertSessionTodo);
  const removeSessionTodoLocal = useSessionStore((s) => s.removeSessionTodoLocal);
  const selectDocument = useSessionStore((s) => s.selectDocument);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(todo.title ?? todo.text ?? '');

  const currentTitle = todo.title ?? todo.text ?? '';

  const handleStatusCycle = useCallback(async () => {
    const idx = STATUS_ORDER.indexOf(todo.status);
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    const optimistic: SessionTodo = { ...todo, status: next, completed: next === 'done' };
    upsertSessionTodo(optimistic);
    try {
      const updated = await api.patchSessionTodo(project, session, todo.id, { status: next });
      upsertSessionTodo(updated);
    } catch (err) {
      upsertSessionTodo(todo);
      console.error('Failed to update todo status', err);
    }
  }, [todo, project, session, upsertSessionTodo]);

  const commitEdit = useCallback(async () => {
    const trimmed = draftText.trim();
    setEditing(false);
    if (!trimmed || trimmed === currentTitle) {
      setDraftText(currentTitle);
      return;
    }
    const optimistic: SessionTodo = { ...todo, title: trimmed };
    upsertSessionTodo(optimistic);
    try {
      const updated = await api.patchSessionTodo(project, session, todo.id, { title: trimmed });
      upsertSessionTodo(updated);
    } catch (err) {
      upsertSessionTodo(todo);
      setDraftText(currentTitle);
      console.error('Failed to update session todo', err);
    }
  }, [draftText, todo, currentTitle, project, session, upsertSessionTodo]);

  const handleDelete = useCallback(async () => {
    const snapshot = useSessionStore.getState().sessionTodos;
    removeSessionTodoLocal(todo.id);
    try {
      await api.removeSessionTodo(project, session, todo.id);
    } catch (err) {
      useSessionStore.getState().setSessionTodos(snapshot);
      console.error('Failed to remove session todo', err);
    }
  }, [todo.id, project, session, removeSessionTodoLocal]);

  const isDone = todo.status === 'done' || todo.completed;

  return (
    <div
      style={{ paddingLeft: '16px' }}
      data-testid={`session-todo-row-${todo.id}`}
    >
      <div className="group w-full text-left px-2 py-1 rounded text-xs flex items-start gap-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
        <button
          onClick={handleStatusCycle}
          title={`Status: ${todo.status} (click to advance)`}
          className={`shrink-0 mt-0.5 inline-flex items-center justify-center rounded px-1 py-0.5 text-[10px] font-mono font-semibold cursor-pointer transition-colors ${STATUS_COLORS[todo.status]}`}
          aria-label={`Status: ${todo.status}`}
        >
          {STATUS_LABEL[todo.status]}
        </button>
        <span className="shrink-0 tabular-nums mt-0.5 select-none text-gray-400 dark:text-gray-500">
          #{todo.id.slice(0, 6)}
        </span>
        {editing ? (
          <input
            type="text"
            value={draftText}
            autoFocus
            onChange={(e) => setDraftText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                setDraftText(currentTitle);
                setEditing(false);
              }
            }}
            className="flex-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        ) : (
          <span
            className={`flex-1 min-w-0 cursor-text whitespace-normal break-words [overflow-wrap:anywhere] ${
              isDone ? 'line-through text-gray-400 dark:text-gray-500' : ''
            }`}
            onClick={() => setEditing(true)}
          >
            {currentTitle}
          </span>
        )}
        {/* Inline badges */}
        {todo.assigneeSession && (
          <span
            title={`Assigned to ${todo.assigneeSession}`}
            className="shrink-0 mt-0.5 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 max-w-[72px] truncate"
          >
            → {todo.assigneeSession}
          </span>
        )}
        {todo.priority !== null && todo.priority !== undefined && (
          <span
            title={`Priority ${todo.priority}`}
            className={`shrink-0 mt-0.5 text-[10px] font-semibold ${PRIORITY_COLORS[todo.priority]}`}
          >
            {PRIORITY_LABEL[todo.priority]}
          </span>
        )}
        {todo.dueDate && (
          <span
            title={`Due: ${todo.dueDate}`}
            className="shrink-0 mt-0.5 text-[10px] text-gray-400 dark:text-gray-500"
          >
            {todo.dueDate.slice(0, 10)}
          </span>
        )}
        {todo.link && (
          <span
            data-testid="todo-link-chip"
            onClick={(e) => { e.stopPropagation(); selectDocument(todo.link!.blueprintId); }}
            title={todo.link.blueprintId + (todo.link.taskId ? ` · ${todo.link.taskId}` : '')}
            className="shrink-0 mt-0.5 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300"
          >
            ↳ {shortSlug(todo.link.blueprintId)}{todo.link.taskId ? ` · ${todo.link.taskId}` : ''}
          </span>
        )}
        <button
          onClick={handleDelete}
          className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
          title="Delete todo"
          aria-label={`Delete ${currentTitle}`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

const TodosTreeSection = forwardRef<SessionTodosSectionHandle, SessionTodosSectionProps>(
  (props, ref) => {
    const {
      currentSession,
      sessionTodos,
      sessionTodosShowCompleted,
      upsertSessionTodo,
      setSessionTodos,
      setSessionTodosShowCompleted,
    } = useSessionStore(
      useShallow((s) => ({
        currentSession: s.currentSession,
        sessionTodos: s.sessionTodos,
        sessionTodosShowCompleted: s.sessionTodosShowCompleted,
        upsertSessionTodo: s.upsertSessionTodo,
        setSessionTodos: s.setSessionTodos,
        setSessionTodosShowCompleted: s.setSessionTodosShowCompleted,
      })),
    );

    const [internalCollapsed, setInternalCollapsed] = useState(false);
    const isCollapsed = props.collapsed ?? internalCollapsed;
    const handleToggle = props.onToggle ?? (() => setInternalCollapsed((c) => !c));

    const [newTodoText, setNewTodoText] = useState('');
    const [confirmClearOpen, setConfirmClearOpen] = useState(false);
    const [addInputVisible, setAddInputVisible] = useState(true);
    const addInputRef = useRef<HTMLInputElement>(null);

    // Filter state
    const [statusFilter, setStatusFilter] = useState<TodoStatus | 'all'>('all');
    const [assignedToMe, setAssignedToMe] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        revealAddInput: () => {
          setAddInputVisible(true);
          setTimeout(() => addInputRef.current?.focus(), 0);
        },
      }),
      [],
    );

    const me = currentSession?.name ?? null;

    const orderedTodos = useMemo(
      () => [...sessionTodos].sort((a, b) => a.order - b.order),
      [sessionTodos],
    );
    const visibleTodos = useMemo(() => {
      let list = sessionTodosShowCompleted
        ? orderedTodos
        : orderedTodos.filter((t) => !t.completed && t.status !== 'done');
      if (statusFilter !== 'all') {
        list = list.filter((t) => t.status === statusFilter);
      }
      if (assignedToMe && me) {
        list = list.filter((t) => t.assigneeSession === me);
      }
      return list;
    }, [orderedTodos, sessionTodosShowCompleted, statusFilter, assignedToMe, me]);

    const completedCount = useMemo(
      () => sessionTodos.filter((t) => t.completed || t.status === 'done').length,
      [sessionTodos],
    );

    const handleAddTodo = useCallback(async () => {
      if (!currentSession) return;
      const trimmed = newTodoText.trim();
      if (!trimmed) return;
      setNewTodoText('');
      try {
        const created = await api.addSessionTodo(
          currentSession.project,
          currentSession.name,
          trimmed,
        );
        upsertSessionTodo(created);
      } catch (err) {
        console.error('Failed to add session todo', err);
        setNewTodoText(trimmed);
      }
    }, [currentSession, newTodoText, upsertSessionTodo]);

    const handleClearCompleted = useCallback(async () => {
      if (!currentSession) return;
      setConfirmClearOpen(false);
      const snapshot = sessionTodos;
      const remaining = sessionTodos.filter((t) => !t.completed && t.status !== 'done');
      setSessionTodos(remaining);
      try {
        await api.clearCompletedSessionTodos(
          currentSession.project,
          currentSession.name,
        );
      } catch (err) {
        console.error('Failed to clear completed session todos', err);
        setSessionTodos(snapshot);
      }
    }, [currentSession, sessionTodos, setSessionTodos]);

    if (!currentSession) return null;

    return (
      <div data-testid="session-todos-section">
        <SectionBranchRow
          id="todos"
          title="Todos"
          count={sessionTodos.length - completedCount}
          collapsed={isCollapsed}
          onToggle={handleToggle}
          level={0}
        />
        {!isCollapsed && (
          <>
            {/* Filter row */}
            <div
              style={{ paddingLeft: '16px' }}
              className="flex items-center gap-2 px-2 py-1 text-xs text-gray-600 dark:text-gray-400"
            >
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TodoStatus | 'all')}
                className="flex-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                <option value="backlog">Backlog</option>
                <option value="todo">Todo</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
              </select>
              {me && (
                <label className="flex items-center gap-1 cursor-pointer select-none whitespace-nowrap" title="Show only todos assigned to me">
                  <input
                    type="checkbox"
                    checked={assignedToMe}
                    onChange={(e) => setAssignedToMe(e.target.checked)}
                    className="w-3 h-3"
                  />
                  Mine
                </label>
              )}
            </div>

            <div
              style={{ paddingLeft: '16px' }}
              className="flex items-center justify-between px-2 py-1 text-xs text-gray-600 dark:text-gray-400"
            >
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sessionTodosShowCompleted}
                  onChange={(e) => setSessionTodosShowCompleted(e.target.checked)}
                  className="w-3 h-3"
                />
                Show completed
              </label>
              <button
                onClick={() => setConfirmClearOpen(true)}
                disabled={completedCount === 0}
                className="hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 disabled:hover:text-gray-600"
                title="Clear completed todos"
              >
                Clear
              </button>
            </div>

            {addInputVisible && (
              <div style={{ paddingLeft: '16px' }} className="px-2 py-1">
                <input
                  ref={addInputRef}
                  type="text"
                  value={newTodoText}
                  onChange={(e) => setNewTodoText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTodo();
                    }
                  }}
                  placeholder="Add a todo..."
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  aria-label="Add a new todo"
                />
              </div>
            )}

            {visibleTodos.length === 0 ? (
              <div
                style={{ paddingLeft: '16px' }}
                className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500 italic"
              >
                {sessionTodos.length === 0 ? 'No todos yet.' : 'No matching todos.'}
              </div>
            ) : (
              visibleTodos.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  project={currentSession.project}
                  session={currentSession.name}
                />
              ))
            )}
          </>
        )}

        <ConfirmClearCompletedDialog
          isOpen={confirmClearOpen}
          completedCount={completedCount}
          onConfirm={handleClearCompleted}
          onCancel={() => setConfirmClearOpen(false)}
        />
      </div>
    );
  },
);

TodosTreeSection.displayName = 'TodosTreeSection';

export default TodosTreeSection;
