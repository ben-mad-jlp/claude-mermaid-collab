/**
 * TodoDetailView — preview-pane detail for a single session todo.
 *
 * Shows the todo's title + markdown-rendered description (read-only), with an
 * Edit mode that lets you edit BOTH the title and the (raw markdown) description.
 * Status / assignee / attached blueprint stay editable in the header.
 *
 * Styling: matches the rest of the app (text-sm, gray-toned, no chromatic
 * status badges) — the detail pane should feel like a document, not a Jira card.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';
import { MarkdownPreview } from './MarkdownPreview';
import type { SessionTodo, TodoStatus } from '@/types/sessionTodo';

function shortSlug(blueprintId: string): string {
  const m = blueprintId.match(/^(?:Implementing|Archive)\/(?:[^/]+\/)?(.+)$/);
  return m ? m[1] : blueprintId;
}

const STATUS_LABEL: Record<TodoStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

// Subtle dot color per status — gives the header a professional status cue
// without turning the pane into a chromatic Jira card.
const STATUS_DOT: Record<TodoStatus, string> = {
  backlog: 'bg-gray-400',
  todo: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  blocked: 'bg-red-500',
  done: 'bg-emerald-500',
};

const PRIORITY_LABEL: Record<number, string> = { 0: 'P0', 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
const PRIORITY_COLORS: Record<number, string> = {
  0: 'text-red-600 dark:text-red-400',
  1: 'text-orange-500 dark:text-orange-400',
  2: 'text-yellow-600 dark:text-yellow-400',
  3: 'text-blue-500 dark:text-blue-400',
  4: 'text-gray-400 dark:text-gray-500',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export interface TodoDetailViewProps {
  todoId: string;
}

export const TodoDetailView: React.FC<TodoDetailViewProps> = ({ todoId }) => {
  const todo = useSessionStore((s) => s.sessionTodos.find((t) => t.id === todoId)) as
    | SessionTodo
    | undefined;
  const currentSession = useSessionStore((s) => s.currentSession);
  const upsertSessionTodo = useSessionStore((s) => s.upsertSessionTodo);
  const selectDocument = useSessionStore((s) => s.selectDocument);

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sibling sessions in this project — for the assignee picker.
  const [siblings, setSiblings] = useState<string[]>([]);
  useEffect(() => {
    const project = currentSession?.project;
    if (!project) return;
    let cancelled = false;
    api.getSessions(project)
      .then((sessions) => { if (!cancelled) setSiblings(sessions.map((s) => s.name)); })
      .catch(() => { /* picker just shows assign/unassign */ });
    return () => { cancelled = true; };
  }, [currentSession?.project]);

  const currentTitle = todo?.title ?? todo?.text ?? '';
  const currentDesc = todo?.description ?? '';

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
        currentSession.project, currentSession.name, todo.id, { status: next },
      );
      upsertSessionTodo(updated);
    } catch (err) {
      upsertSessionTodo(todo);
      setError(err instanceof Error ? err.message : 'Failed to update status.');
    }
  }, [todo, currentSession, upsertSessionTodo]);

  const changeAssignee = useCallback(async (value: string) => {
    if (!todo || !currentSession) return;
    const assigneeSession = value || null;
    const optimistic: SessionTodo = { ...todo, assigneeSession };
    upsertSessionTodo(optimistic);
    try {
      const updated = await api.patchSessionTodo(
        currentSession.project, currentSession.name, todo.id, { assigneeSession },
      );
      upsertSessionTodo(updated);
    } catch (err) {
      upsertSessionTodo(todo);
      setError(err instanceof Error ? err.message : 'Failed to update assignee.');
    }
  }, [todo, currentSession, upsertSessionTodo]);

  const save = useCallback(async () => {
    if (!todo || !currentSession) return;
    const title = draftTitle.trim();
    if (!title) {
      setError('Title cannot be empty.');
      return;
    }
    const description = draftDesc;
    setSaving(true);
    setError(null);
    const optimistic: SessionTodo = { ...todo, title, description: description || null };
    upsertSessionTodo(optimistic);
    try {
      const updated = await api.patchSessionTodo(
        currentSession.project, currentSession.name, todo.id, { title, description },
      );
      upsertSessionTodo(updated);
      setEditing(false);
    } catch (err) {
      upsertSessionTodo(todo);
      setError(err instanceof Error ? err.message : 'Failed to save todo.');
    } finally {
      setSaving(false);
    }
  }, [todo, currentSession, draftTitle, draftDesc, upsertSessionTodo]);

  if (!todo) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Todo not found (it may have been deleted).
      </div>
    );
  }

  const status: TodoStatus = todo.status ?? (todo.completed ? 'done' : 'todo');

  // Shared chrome-less control styling so status/assignee read as plain text.
  const plainControl =
    'shrink-0 bg-transparent border-none rounded px-1 py-0.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600';

  return (
    <div
      className="h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden text-gray-900 dark:text-gray-100"
      data-testid={`todo-detail-${todo.id}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-sm">
        <span
          className="shrink-0 tabular-nums text-xs text-gray-400 dark:text-gray-500 select-all"
          title={todo.id}
        >
          #{String(todo.id).slice(-4)}
        </span>
        <span
          className={`shrink-0 w-2 h-2 rounded-full ${STATUS_DOT[status]}`}
          aria-hidden="true"
        />
        <select
          value={status}
          onChange={(e) => changeStatus(e.target.value as TodoStatus)}
          aria-label="Status"
          className={plainControl}
        >
          {(Object.keys(STATUS_LABEL) as TodoStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select
          value={todo.assigneeSession ?? ''}
          onChange={(e) => changeAssignee(e.target.value)}
          aria-label="Assignee"
          title={todo.assigneeSession ? `Assigned to ${todo.assigneeSession}` : 'Assign to a session'}
          className={`${plainControl} max-w-[200px] truncate`}
        >
          <option value="">{todo.assigneeSession ? 'Assignee · ✕' : 'Assignee · –'}</option>
          {todo.assigneeSession && !siblings.includes(todo.assigneeSession) && (
            <option value={todo.assigneeSession}>{todo.assigneeSession}</option>
          )}
          {siblings.map((name) => (
            <option key={name} value={name}>
              {name}{name === currentSession?.name ? ' (me)' : ''}
            </option>
          ))}
        </select>
        {todo.link && (
          <span
            data-testid="todo-detail-link-chip"
            onClick={() => selectDocument(todo.link!.blueprintId)}
            title={todo.link.blueprintId + (todo.link.taskId ? ` · ${todo.link.taskId}` : '')}
            className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-200 max-w-[220px] truncate"
          >
            ↳ {shortSlug(todo.link.blueprintId)}{todo.link.taskId ? ` · ${todo.link.taskId}` : ''}
          </span>
        )}
        <div className="flex-1" />
        {editing ? (
          <>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="px-2 py-1 text-sm rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-2 py-1 text-sm rounded bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <button
            onClick={beginEdit}
            className="px-2 py-1 text-sm rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Edit
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-1.5 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {editing ? (
          <div className="px-6 py-5 max-w-3xl mx-auto w-full flex flex-col gap-3 h-full">
            <input
              type="text"
              value={draftTitle}
              autoFocus
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Title"
              className="w-full bg-transparent border-0 border-b border-gray-200 dark:border-gray-700 rounded-none px-0 py-1 text-base font-medium text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500"
            />
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="Description (markdown)…"
              className="flex-1 min-h-[200px] resize-none bg-transparent border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600"
            />
          </div>
        ) : (
          <div className="px-6 py-5 max-w-3xl mx-auto">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 break-words [overflow-wrap:anywhere]">
              {currentTitle}
            </h1>

            {/* Metadata bar — status, priority, due, assignee at a glance */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
                <span className="font-medium text-gray-700 dark:text-gray-300">{STATUS_LABEL[status]}</span>
              </span>
              {todo.priority !== null && todo.priority !== undefined && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-gray-400 dark:text-gray-500">Priority</span>
                  <span className={`font-semibold ${PRIORITY_COLORS[todo.priority]}`}>
                    {PRIORITY_LABEL[todo.priority]}
                  </span>
                </span>
              )}
              {formatDate(todo.dueDate) && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-gray-400 dark:text-gray-500">Due</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{formatDate(todo.dueDate)}</span>
                </span>
              )}
              {todo.assigneeSession && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-gray-400 dark:text-gray-500">Assignee</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300 truncate max-w-[180px]">
                    {todo.assigneeSession}{todo.assigneeSession === currentSession?.name ? ' (me)' : ''}
                  </span>
                </span>
              )}
            </div>

            <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pt-5">
              {currentDesc.trim() ? (
                <div className="text-sm leading-relaxed">
                  <MarkdownPreview content={currentDesc} />
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                  No description. Press <span className="font-medium">Edit</span> to add one.
                </p>
              )}
            </div>

            {formatDate(todo.updatedAt) && (
              <p className="mt-8 text-[11px] text-gray-400 dark:text-gray-500">
                Updated {formatDate(todo.updatedAt)}
                {formatDate(todo.createdAt) ? ` · Created ${formatDate(todo.createdAt)}` : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TodoDetailView;
