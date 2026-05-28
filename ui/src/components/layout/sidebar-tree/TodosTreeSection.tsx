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
import { useTabsStore } from '@/stores/tabsStore';
import { api } from '@/lib/api';
import { SessionTodo, TodoStatus } from '@/types/sessionTodo';
import { SectionBranchRow } from './TreeBranchRow';

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
  const removeSessionTodoLocal = useSessionStore((s) => s.removeSessionTodoLocal);
  const openPreview = useTabsStore((s) => s.openPreview);

  const currentTitle = todo.title ?? todo.text ?? '';

  // Open this todo in the preview pane (view + edit title/description there).
  // Todos are no longer edited inline in the sidebar.
  const openDetail = useCallback(() => {
    openPreview({
      id: `todo-detail:${todo.id}`,
      kind: 'todo-detail',
      artifactId: todo.id,
      name: currentTitle || 'Todo',
    });
  }, [openPreview, todo.id, currentTitle]);
  // Tolerate legacy/old-backend todos that lack `status` (numeric-id era).
  // Status is shown/changed in the detail pane now, not the sidebar; we keep
  // this only to strike through completed rows.
  const status: TodoStatus = todo.status ?? (todo.completed ? 'done' : 'todo');

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

  const isDone = status === 'done' || todo.completed;

  return (
    <div
      style={{ paddingLeft: '16px' }}
      data-testid={`session-todo-row-${todo.id}`}
    >
      <div className="group w-full text-left px-2 py-1.5 rounded flex flex-col gap-0.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
        {/* Row 1 — title + (hover) delete */}
        <div className="flex items-start gap-2">
          <span
            className={`flex-1 min-w-0 cursor-pointer text-sm leading-snug whitespace-normal break-words [overflow-wrap:anywhere] ${
              isDone ? 'line-through text-gray-400 dark:text-gray-500' : ''
            }`}
            onClick={openDetail}
            title="Open todo details"
          >
            {currentTitle}
          </span>
          <button
            onClick={handleDelete}
            className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
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
        {/* Row 2 — meta: only priority + due date in the sidebar.
            Assignee + attached artifact (link) live in the detail pane. */}
        {(todo.priority !== null && todo.priority !== undefined) || todo.dueDate ? (
          <div className="flex items-center gap-2 flex-wrap text-sm text-gray-400 dark:text-gray-500">
            {todo.priority !== null && todo.priority !== undefined && (
              <span
                title={`Priority ${todo.priority}`}
                className={`shrink-0 text-sm font-semibold ${PRIORITY_COLORS[todo.priority]}`}
              >
                {PRIORITY_LABEL[todo.priority]}
              </span>
            )}
            {todo.dueDate && (
              <span title={`Due: ${todo.dueDate}`} className="shrink-0 text-sm">
                {todo.dueDate.slice(0, 10)}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const TodosTreeSection = forwardRef<SessionTodosSectionHandle, SessionTodosSectionProps>(
  (props, ref) => {
    const {
      currentSession,
      sessionTodos,
      upsertSessionTodo,
      setSessionTodos,
    } = useSessionStore(
      useShallow((s) => ({
        currentSession: s.currentSession,
        sessionTodos: s.sessionTodos,
        upsertSessionTodo: s.upsertSessionTodo,
        setSessionTodos: s.setSessionTodos,
      })),
    );

    const [internalCollapsed, setInternalCollapsed] = useState(false);
    const isCollapsed = props.collapsed ?? internalCollapsed;
    const handleToggle = props.onToggle ?? (() => setInternalCollapsed((c) => !c));

    const [newTodoText, setNewTodoText] = useState('');
    const [addInputVisible, setAddInputVisible] = useState(true);
    const addInputRef = useRef<HTMLInputElement>(null);


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


    const orderedTodos = useMemo(
      () => [...sessionTodos].sort((a, b) => a.order - b.order),
      [sessionTodos],
    );
    // Sidebar shows active todos only; completed ones drop out of the list
    // (they're still in the store — set via the detail pane's status dropdown,
    // removed via Clear).
    const visibleTodos = useMemo(
      () => orderedTodos.filter((t) => !t.completed && t.status !== 'done'),
      [orderedTodos],
    );

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
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  aria-label="Add a new todo"
                />
              </div>
            )}

            {visibleTodos.length === 0 ? (
              <div
                style={{ paddingLeft: '16px' }}
                className="px-2 py-1 text-sm text-gray-400 dark:text-gray-500 italic"
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
      </div>
    );
  },
);

TodosTreeSection.displayName = 'TodosTreeSection';

export default TodosTreeSection;
