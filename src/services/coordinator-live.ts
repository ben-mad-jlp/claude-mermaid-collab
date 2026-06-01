import type { Todo } from './todo-store';
import { listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, updateTodo } from './todo-store';
import { launchAndBind } from './claude-launch';
import { runTick, type CoordinatorDeps } from './coordinator-daemon';

const DEFAULT_WORKER_TOOLS = 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid';

/** Wire the Coordinator daemon to the real todo-store + a live worker launcher. */
export function makeCoordinatorDeps(): CoordinatorDeps {
  return {
    listReadyTodos,
    claimTodo,
    releaseExpiredClaims,
    completeTodo,
    launchWorker: async (project: string, todo: Todo): Promise<boolean> => {
      const session = `worker-${todo.id.slice(0, 8)}`;
      const r = await launchAndBind({ project, session, allowedTools: DEFAULT_WORKER_TOOLS });
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
