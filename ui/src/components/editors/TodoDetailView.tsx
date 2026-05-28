/**
 * TodoDetailView — preview-pane detail for a single session todo.
 *
 * Shows the todo's title + markdown-rendered description (read-only), with an
 * Edit mode that lets you edit BOTH the title and the (raw markdown) description.
 * Saving patches the todo via the REST API and updates the session store.
 *
 * Todos are no longer edited inline in the sidebar — this is their editor.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';
import { MarkdownPreview } from './MarkdownPreview';
import type { SessionTodo, TodoStatus } from '@/types/sessionTodo';

const STATUS_LABEL: Record<TodoStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

const STATUS_COLORS: Record<TodoStatus, string> = {
  backlog: 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800',
  todo: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
  in_progress: 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30',
  blocked: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30',
  done: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30',
};

export interface TodoDetailViewProps {
  todoId: string;
}

export const TodoDetailView: React.FC<TodoDetailViewProps> = ({ todoId }) => {
  const todo = useSessionStore((s) => s.sessionTodos.find((t) => t.id === todoId)) as
    | SessionTodo
    | undefined;
  const currentSession = useSessionStore((s) => s.currentSession);
  const upsertSessionTodo = useSessionStore((s) => s.upsertSessionTodo);

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentTitle = todo?.title ?? todo?.text ?? '';
  const currentDesc = todo?.description ?? '';

  // Reset drafts whenever the underlying todo changes (e.g. a WS update) and
  // we're not mid-edit, so the view reflects the latest server state.
  useEffect(() => {
    if (!editing) {
      setDraftTitle(currentTitle);
      setDraftDesc(currentDesc);
    }
  }, [currentTitle, currentDesc, editing]);

  const beginEdit = useCallback(() => {
    setDraftTitle(currentTitle);
    setDraftDesc(currentDesc);
    setError(null);
    setEditing(true);
  }, [currentTitle, currentDesc]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setError(null);
    setDraftTitle(currentTitle);
    setDraftDesc(currentDesc);
  }, [currentTitle, currentDesc]);

  const changeStatus = useCallback(async (next: TodoStatus) => {
    if (!todo || !currentSession) return;
    const optimistic: SessionTodo = { ...todo, status: next, completed: next === 'done' };
    upsertSessionTodo(optimistic);
    try {
      const updated = await api.patchSessionTodo(
        currentSession.project,
        currentSession.name,
        todo.id,
        { status: next },
      );
      upsertSessionTodo(updated);
    } catch (err) {
      upsertSessionTodo(todo);
      setError(err instanceof Error ? err.message : 'Failed to update status.');
    }
  }, [todo, currentSession, upsertSessionTodo]);

  const save = useCallback(async () => {
    if (!todo || !currentSession) return;
    const title = draftTitle.trim();
    if (!title) {
      setError('Title cannot be empty.');
      return;
    }
    const description = draftDesc; // allow empty string → blank description
    setSaving(true);
    setError(null);
    // Optimistic update.
    const optimistic: SessionTodo = { ...todo, title, description: description || null };
    upsertSessionTodo(optimistic);
    try {
      const updated = await api.patchSessionTodo(
        currentSession.project,
        currentSession.name,
        todo.id,
        { title, description },
      );
      upsertSessionTodo(updated);
      setEditing(false);
    } catch (err) {
      upsertSessionTodo(todo); // roll back
      setError(err instanceof Error ? err.message : 'Failed to save todo.');
    } finally {
      setSaving(false);
    }
  }, [todo, currentSession, draftTitle, draftDesc, upsertSessionTodo]);

  if (!todo) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
        Todo not found (it may have been deleted).
      </div>
    );
  }

  const status: TodoStatus = todo.status ?? (todo.completed ? 'done' : 'todo');

  return (
    <div
      className="h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden"
      data-testid={`todo-detail-${todo.id}`}
    >
      {/* Header / toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <select
          value={status}
          onChange={(e) => changeStatus(e.target.value as TodoStatus)}
          title="Status"
          aria-label="Status"
          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold cursor-pointer border-none focus:outline-none focus:ring-1 focus:ring-blue-400 ${STATUS_COLORS[status]}`}
        >
          {(Object.keys(STATUS_LABEL) as TodoStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="shrink-0 tabular-nums text-xs text-gray-400 dark:text-gray-500">
          #{String(todo.id).slice(0, 6)}
        </span>
        {todo.assigneeSession && (
          <span className="shrink-0 text-xs text-purple-600 dark:text-purple-400 truncate max-w-[140px]">
            → {todo.assigneeSession}
          </span>
        )}
        <div className="flex-1" />
        {editing ? (
          <>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="px-2 py-1 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <button
            onClick={beginEdit}
            className="px-2 py-1 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Edit
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {editing ? (
          <div className="flex flex-col gap-3 h-full">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                Title
              </label>
              <input
                type="text"
                value={draftTitle}
                autoFocus
                onChange={(e) => setDraftTitle(e.target.value)}
                className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div className="flex-1 flex flex-col min-h-0">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                Description (markdown)
              </label>
              <textarea
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                placeholder="Add a description…"
                className="flex-1 min-h-[160px] resize-none font-mono bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 break-words [overflow-wrap:anywhere]">
              {currentTitle}
            </h1>
            {currentDesc.trim() ? (
              <MarkdownPreview content={currentDesc} />
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                No description. Click <span className="font-medium">Edit</span> to add one.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TodoDetailView;
