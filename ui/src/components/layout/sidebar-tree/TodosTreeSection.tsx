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
import { SessionTodo } from '@/types';
import { SectionBranchRow } from './TreeBranchRow';

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
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(todo.text);

  const handleToggle = useCallback(async () => {
    const next = { ...todo, completed: !todo.completed };
    upsertSessionTodo(next);
    try {
      const updated = await api.patchSessionTodo(project, session, todo.id, {
        completed: !todo.completed,
      });
      upsertSessionTodo(updated);
    } catch (err) {
      upsertSessionTodo(todo);
      console.error('Failed to toggle session todo', err);
    }
  }, [todo, project, session, upsertSessionTodo]);

  const commitEdit = useCallback(async () => {
    const trimmed = draftText.trim();
    setEditing(false);
    if (!trimmed || trimmed === todo.text) {
      setDraftText(todo.text);
      return;
    }
    const optimistic = { ...todo, text: trimmed };
    upsertSessionTodo(optimistic);
    try {
      const updated = await api.patchSessionTodo(project, session, todo.id, {
        text: trimmed,
      });
      upsertSessionTodo(updated);
    } catch (err) {
      upsertSessionTodo(todo);
      setDraftText(todo.text);
      console.error('Failed to update session todo', err);
    }
  }, [draftText, todo, project, session, upsertSessionTodo]);

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

  return (
    <div
      style={{ paddingLeft: '16px' }}
      data-testid={`session-todo-row-${todo.id}`}
    >
      <div className="group w-full text-left px-2 py-1 rounded text-xs flex items-start gap-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
        <input
          type="checkbox"
          checked={todo.completed}
          onChange={handleToggle}
          className="w-3.5 h-3.5 shrink-0 cursor-pointer mt-0.5"
          aria-label={`Toggle ${todo.text}`}
        />
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
                setDraftText(todo.text);
                setEditing(false);
              }
            }}
            className="flex-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        ) : (
          <span
            className={`flex-1 min-w-0 cursor-text whitespace-normal break-words [overflow-wrap:anywhere] ${
              todo.completed ? 'line-through text-gray-400 dark:text-gray-500' : ''
            }`}
            onClick={() => setEditing(true)}
          >
            {todo.text}
          </span>
        )}
        <button
          onClick={handleDelete}
          className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
          title="Delete todo"
          aria-label={`Delete ${todo.text}`}
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
    const visibleTodos = useMemo(
      () =>
        sessionTodosShowCompleted
          ? orderedTodos
          : orderedTodos.filter((t) => !t.completed),
      [orderedTodos, sessionTodosShowCompleted],
    );
    const completedCount = useMemo(
      () => sessionTodos.filter((t) => t.completed).length,
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
      const remaining = sessionTodos.filter((t) => !t.completed);
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
