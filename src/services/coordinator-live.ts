import type { Todo } from './todo-store';
import { listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, updateTodo, getTodo, listTodos, reclaimClaim } from './todo-store';
import { createEscalation } from './supervisor-store';
import { tmuxBaseName } from './tmux-naming';
import { launchAndBind } from './claude-launch';
import { runTick, type CoordinatorDeps } from './coordinator-daemon';
import { resolveProfile, type AgentProfile } from '../config/agent-profiles';

/** True if a tmux session with this base name exists (worker still alive). */
function isTmuxAlive(tmux: string): boolean {
  try {
    return Bun.spawnSync(['tmux', 'has-session', '-t', tmux], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
  } catch {
    // can't check → assume alive (don't reclaim on uncertainty; the lease still backstops).
    return true;
  }
}

/** Per-todo agent profile → launch params (PCS Phase 3). The todo's `type`
 *  (when present; assigned at sync time per #8) resolves to a registry profile
 *  (tools/model/runtimeMode); the `invokeSkill` makes the worker autonomous:
 *  after `/collab` binds the session, the worker skill reads its claimed todo
 *  (by id), works it, runs the mechanical acceptance gate, and reports via
 *  `complete_todo`. Unknown/missing type → the `default` profile. */
export function resolveWorkerProfile(todo: Todo): AgentProfile & { invokeSkill: string } {
  const profile = resolveProfile(todo.type);
  return { ...profile, invokeSkill: `/mermaid-collab:worker ${todo.id}` };
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
      const { allowedTools, invokeSkill, model, runtimeMode } = resolveWorkerProfile(todo);
      const r = await launchAndBind({ project, session, allowedTools, invokeSkill, model, runtimeMode });
      if (r.started) {
        try { await updateTodo(project, todo.id, { sessionName: session }); } catch { /* spawn already succeeded; lease covers any inconsistency */ }
      }
      return !!r.started;
    },
    reapDeadClaims: async (project: string): Promise<{ reclaimed: string[]; exhausted: string[] }> => {
      const reclaimed: string[] = [];
      const exhausted: string[] = [];
      for (const t of listTodos(project, { status: 'in_progress' })) {
        const session = t.sessionName ?? `worker-${t.id.slice(0, 8)}`;
        if (isTmuxAlive(tmuxBaseName(project, session))) continue; // worker still running
        const next = await reclaimClaim(project, t.id);
        if (next === 'ready') reclaimed.push(t.id);
        else if (next === 'blocked') exhausted.push(t.id);
      }
      return { reclaimed, exhausted };
    },
    escalateExhausted: async (project: string, todoId: string): Promise<void> => {
      const todo = getTodo(project, todoId);
      createEscalation({
        project,
        session: todo?.sessionName ?? `worker-${todoId.slice(0, 8)}`,
        kind: 'blocker',
        questionText: `Todo "${todo?.title ?? todoId}" exhausted its retry budget (worker repeatedly failed to complete it). Parked as blocked — needs a human decision.`,
      });
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
