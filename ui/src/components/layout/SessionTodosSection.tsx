import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';
import { ConfirmClearCompletedDialog } from '@/components/dialogs/ConfirmClearCompletedDialog';
import { SessionTodo } from '@/types';

interface TodoRowProps {
  todo: SessionTodo;
  project: string;
  session: string;
  onDragStart: (e: React.DragEvent, id: number) => void;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  isDragOver: boolean;
}

const TodoRow: React.FC<TodoRowProps> = ({
  todo,
  project,
  session,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  isDragOver,
}) => {
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
      className={`group flex items-start gap-2 px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
        isDragOver ? 'border-t-2 border-blue-400' : ''
      }`}
      draggable={!editing}
      onDragStart={(e) => onDragStart(e, todo.id)}
      onDragOver={(e) => onDragOver(e, todo.id)}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      data-testid={`session-todo-row-${todo.id}`}
    >
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={handleToggle}
        className="w-3.5 h-3.5 shrink-0 cursor-pointer mt-0.5"
        aria-label={`Toggle ${todo.text}`}
      />
      <div className="flex-1 min-w-0">
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
            className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        ) : (
          <span
            className={`block cursor-text break-words ${
              todo.completed
                ? 'line-through text-gray-400 dark:text-gray-500'
                : 'text-gray-700 dark:text-gray-300'
            }`}
            onClick={() => setEditing(true)}
          >
            {todo.text}
          </span>
        )}
      </div>
      <button
        onClick={handleDelete}
        className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
        title="Delete todo"
        aria-label={`Delete ${todo.text}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
    </div>
  );
};

export const SessionTodosSection: React.FC = () => {
  const {
    currentSession,
    sessionTodos,
    sessionTodosShowCompleted,
    setSessionTodos,
    upsertSessionTodo,
    setSessionTodosList,
    setSessionTodosShowCompleted,
  } = useSessionStore(
    useShallow((state) => ({
      currentSession: state.currentSession,
      sessionTodos: state.sessionTodos,
      sessionTodosShowCompleted: state.sessionTodosShowCompleted,
      setSessionTodos: state.setSessionTodos,
      upsertSessionTodo: state.upsertSessionTodo,
      setSessionTodosList: state.setSessionTodosList,
      setSessionTodosShowCompleted: state.setSessionTodosShowCompleted,
    })),
  );

  const [collapsed, setCollapsed] = useState(false);
  const [newTodoText, setNewTodoText] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const dragIdRef = useRef<number | null>(null);
  const didDropRef = useRef(false);

  const orderedTodos = useMemo(() => {
    return [...sessionTodos].sort((a, b) => a.order - b.order);
  }, [sessionTodos]);

  const visibleTodos = useMemo(() => {
    return sessionTodosShowCompleted
      ? orderedTodos
      : orderedTodos.filter((t) => !t.completed);
  }, [orderedTodos, sessionTodosShowCompleted]);

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

  const handleDragStart = useCallback((e: React.DragEvent, id: number) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    didDropRef.current = true;
  }, []);

  const handleDragEnd = useCallback(async () => {
    const dropped = didDropRef.current;
    didDropRef.current = false;
    if (!dropped) {
      dragIdRef.current = null;
      setDragOverId(null);
      return;
    }
    const fromId = dragIdRef.current;
    const toId = dragOverId;
    dragIdRef.current = null;
    setDragOverId(null);
    if (!currentSession || fromId == null || toId == null || fromId === toId) return;

    const ids = visibleTodos.map((t) => t.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, fromId);

    const visibleSet = new Set(ids);
    const fullOrderedIds: number[] = [];
    let visibleCursor = 0;
    for (const t of orderedTodos) {
      if (visibleSet.has(t.id)) {
        fullOrderedIds.push(ids[visibleCursor++]);
      } else {
        fullOrderedIds.push(t.id);
      }
    }

    const byId = new Map(sessionTodos.map((t) => [t.id, t]));
    const optimistic = fullOrderedIds.map((id, idx) => {
      const t = byId.get(id)!;
      return { ...t, order: idx };
    });
    setSessionTodosList(optimistic);

    try {
      const updated = await api.reorderSessionTodos(
        currentSession.project,
        currentSession.name,
        fullOrderedIds,
      );
      setSessionTodos(updated);
    } catch (err) {
      console.error('Failed to reorder session todos', err);
      setSessionTodos(sessionTodos);
    }
  }, [
    dragOverId,
    currentSession,
    visibleTodos,
    orderedTodos,
    sessionTodos,
    setSessionTodos,
    setSessionTodosList,
  ]);

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
    <div className="border-b border-gray-200 dark:border-gray-700" data-testid="session-todos-section">
      <div className="flex items-center">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span>Todos</span>
          <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">
            {sessionTodos.length}
          </span>
          <svg
            className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${
              collapsed ? '-rotate-90' : ''
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className="px-2 pb-2">
          <div className="flex items-center justify-between px-1 py-1">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
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
              className="text-xs text-gray-500 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 disabled:hover:text-gray-500 transition-colors"
              title="Clear completed todos"
            >
              Clear completed
            </button>
          </div>

          <div className="px-1 py-1">
            <input
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

          {visibleTodos.length === 0 ? (
            <div className="px-2 py-2 text-xs text-gray-400 dark:text-gray-500 italic">
              {sessionTodos.length === 0
                ? 'No todos yet.'
                : 'No matching todos.'}
            </div>
          ) : (
            <div
              className="space-y-0.5 max-h-80 overflow-y-auto"
              onDragLeave={() => setDragOverId(null)}
            >
              {visibleTodos.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  project={currentSession.project}
                  session={currentSession.name}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop}
                  isDragOver={dragOverId === todo.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmClearCompletedDialog
        isOpen={confirmClearOpen}
        completedCount={completedCount}
        onConfirm={handleClearCompleted}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
};

export default SessionTodosSection;
