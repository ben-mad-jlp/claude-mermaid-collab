import type { Todo } from './todo-store';
import { listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, updateTodo } from './todo-store';
import { launchAndBind } from './claude-launch';
import { runTick, type CoordinatorDeps } from './coordinator-daemon';

const DEFAULT_WORKER_TOOLS = 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid';

/** Per-todo agent profile → launch params. Taxonomy (frontend/backend/api/…) is
 *  deferred (design #8); for now every todo resolves to the `full` default. The
 *  `invokeSkill` makes the worker autonomous: after `/collab` binds the session,
 *  the worker skill reads its claimed todo (by id), works it, runs the mechanical
 *  acceptance gate, and reports via `complete_todo`. */
export function resolveWorkerProfile(todo: Todo): { allowedTools: string; invokeSkill: string } {
  return {
    allowedTools: DEFAULT_WORKER_TOOLS,
    invokeSkill: `/mermaid-collab:worker ${todo.id}`,
  };
}

/** Wire the Coordinator daemon to the real todo-store + a live worker launcher. */
export function makeCoordinatorDeps(): CoordinatorDeps {
  return {
    listReadyTodos,
    claimTodo,
    releaseExpiredClaims,
    completeTodo,
    launchWorker: async (project: string, todo: Todo): Promise<boolean> => {
      const session = `worker-${todo.id.slice(0, 8)}`;
      const { allowedTools, invokeSkill } = resolveWorkerProfile(todo);
      const r = await launchAndBind({ project, session, allowedTools, invokeSkill });
      if (r.started) {
        try { await updateTodo(project, todo.id, { sessionName: session }); } catch { /* spawn already succeeded; lease covers any inconsistency */ }
      }
      return !!r.started;
    },
  };
}

const timers = new Map<string, ReturnType<typeof setInterval>>();

/** Start a per-project coordinator tick loop. Returns false if already running. Explicit-start only (never auto-started at boot). */
export function startCoordinator(project: string, intervalMs = 30_000): boolean {
  if (timers.has(project)) return false;
  const deps = makeCoordinatorDeps();
  const t = setInterval(() => {
    void runTick(deps, project).catch(() => { /* never let a tick rejection kill the loop */ });
  }, intervalMs);
  (t as { unref?: () => void }).unref?.();
  timers.set(project, t);
  return true;
}

export function stopCoordinator(project: string): boolean {
  const t = timers.get(project);
  if (!t) return false;
  clearInterval(t);
  timers.delete(project);
  return true;
}

export function isCoordinatorRunning(project: string): boolean {
  return timers.has(project);
}
