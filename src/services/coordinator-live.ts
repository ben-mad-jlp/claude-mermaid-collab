import type { Todo } from './todo-store';
import { listReadyTodos, claimTodo, releaseExpiredClaims, completeTodo, updateTodo, getTodo, listTodos, reclaimClaim } from './todo-store';
import { createEscalation, recordSupervisorAudit, addSupervised, addWatchedProject } from './supervisor-store';
import { tmuxBaseName } from './tmux-naming';
import { ensureSession, runTodoInSession } from './claude-launch';
import { runTick, type CoordinatorDeps } from './coordinator-daemon';
import { resolveProfile, type AgentProfile } from '../config/agent-profiles';
import {
  todoTypeToPoolType,
  poolTypeForFiles,
  findIdleSessionForType,
  getOrCreateSlot,
  poolSessionName,
  markBusy,
  markIdle,
} from './worker-pool';

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
    // Wrapped to record coordinator lifecycle events into the supervisor audit
    // log → it doubles as the unified orchestration trace (open-problem #10/obs).
    claimTodo: async (project, id, claimedBy, leaseMs) => {
      const c = await claimTodo(project, id, claimedBy, leaseMs);
      if (c) recordSupervisorAudit({ kind: 'claim', project, session: c.sessionName ?? '', detail: JSON.stringify({ todoId: id, claimedBy }) });
      return c;
    },
    releaseExpiredClaims,
    completeTodo: async (project, id, acceptance) => {
      const r = await completeTodo(project, id, acceptance);
      // POOL-4 keep-warm: the worker's pool session is NOT killed on complete —
      // mark its slot idle so it can take the next matching todo (context is bounded
      // only by the context-watchdog, never an idle-kill here). The slot frees on
      // the session name the todo was claimed under.
      const session = r.completed.sessionName ?? '';
      if (session) markIdle(session);
      recordSupervisorAudit({ kind: 'complete', project, session, detail: JSON.stringify({ todoId: id, acceptance: acceptance ?? r.completed.acceptanceStatus, promoted: r.promoted }) });
      return r;
    },
    launchWorker: async (project: string, todo: Todo): Promise<boolean> => {
      // POOL-4: route the todo to a persistent, role-typed pool session instead
      // of spawning a fresh worker-<id8> per todo.
      //
      // 1. Resolve the pool type. Prefer the todo's assigned `type` (set at sync
      //    time, the same input resolveProfile/resolveWorkerProfile uses); if it's
      //    null, fall back to file-based inference (poolTypeForFiles). Both default
      //    unmatched → 'general'.
      const files = (todo as { files?: string[] | null }).files;
      const poolType = todo.type ? todoTypeToPoolType(todo.type) : (files ? poolTypeForFiles(files) : 'general');

      // 2. Find a routable session of that type. Prefer a warm idle session; else
      //    lazily grab a slot within the type's budget. At capacity (no idle + no
      //    slot budget) → defer: return false so the todo's lease lapses and a
      //    later tick reclaims it back to ready (bounded parallelism). Audit the
      //    deferral instead of silently dropping.
      let poolName = findIdleSessionForType(poolType);
      if (!poolName) {
        const slot = getOrCreateSlot(poolType);
        if (!slot) {
          recordSupervisorAudit({ kind: 'spawn', project, session: poolSessionName(poolType), detail: JSON.stringify({ todoId: todo.id, type: poolType, started: false, reason: 'pool-busy-deferred' }) });
          return false;
        }
        poolName = poolSessionName(slot.type, slot.slot);
      }

      const { allowedTools, invokeSkill, model, runtimeMode } = resolveWorkerProfile(todo);

      // 3. Spawn or reuse the pool session (idempotent — ensureSession reuses a
      //    live, bound session), then send the worker skill into it. Profile
      //    params still drive tools/model/runtimeMode.
      const ensured = await ensureSession({ project, session: poolName, allowedTools, model, runtimeMode });
      const started = ensured.ready;
      let reason = ensured.reason;
      if (started) {
        const run = await runTodoInSession({ session: poolName, invokeSkill, tmux: ensured.tmux });
        if (!run.sent) reason = run.reason;
      }
      const ok = started && reason === undefined;

      if (ok) {
        markBusy(poolName, todo.id);
        // Claim continues under the pool session name (todo.sessionName = poolName)
        // so reclaim/lease semantics and the dead-claim reaper key off it.
        try { await updateTodo(project, todo.id, { sessionName: poolName }); } catch { /* spawn already succeeded; lease covers any inconsistency */ }
        // POOL-2: auto-subscribe the pool session into the supervisor's Watching
        // list so a card appears. Idempotent (addSupervised INSERT OR IGNORE on PK,
        // addWatchedProject no-ops when watched) — safe to re-run when a warm pool
        // session takes a second todo.
        try {
          addSupervised(project, poolName, 'spawn');
          addWatchedProject(project);
        } catch { /* watching registration is best-effort; spawn already succeeded */ }
      }
      recordSupervisorAudit({ kind: 'spawn', project, session: poolName, detail: JSON.stringify({ todoId: todo.id, type: poolType, started: ok, reason }) });
      return ok;
    },
    reapDeadClaims: async (project: string): Promise<{ reclaimed: string[]; exhausted: string[] }> => {
      const reclaimed: string[] = [];
      const exhausted: string[] = [];
      // Only in_progress todos can have a dead worker. A WARM IDLE pool session is
      // never reaped here: its todo is already `done` (not in_progress) so it isn't
      // iterated, and even if an in_progress todo points at it, its tmux is alive →
      // we `continue`. We only reclaim a todo whose lease backstop applies AND whose
      // session/tmux is actually gone (hard-dead worker), then free its pool slot so
      // the slot isn't wedged busy on a vanished session.
      for (const t of listTodos(project, { status: 'in_progress' })) {
        const session = t.sessionName ?? `worker-${t.id.slice(0, 8)}`;
        if (isTmuxAlive(tmuxBaseName(project, session))) continue; // worker still running (incl. warm idle pool sessions)
        const next = await reclaimClaim(project, t.id);
        // The session is gone — release the pool slot it held (no-op if it wasn't a pool session).
        markIdle(session);
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
    escalateRejected: async (project: string, todoId: string): Promise<void> => {
      const todo = getTodo(project, todoId);
      createEscalation({
        project,
        session: todo?.sessionName ?? `worker-${todoId.slice(0, 8)}`,
        kind: 'blocker',
        questionText: `Worker REJECTED todo "${todo?.title ?? todoId}" — its mechanical acceptance gate (tsc + tests) failed and it couldn't fix it in scope. Not auto-retried. Re-open with guidance, split, or drop it.`,
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
  // An explicit stop also opts the project out of auto-respawn — otherwise the
  // watchdog would immediately fight a deliberate UI/operator "Stop daemon".
  autoManaged.delete(project);
  maybeStopWatchdog();
  const t = timers.get(project);
  if (!t) return false;
  clearInterval(t);
  timers.delete(project);
  return true;
}

export function isCoordinatorRunning(project: string): boolean {
  return timers.has(project);
}

// --- Always-on auto-start + self-respawn (PCS infra) ---
//
// Projects registered via autoStartCoordinator() are kept running by a single
// global watchdog: it periodically re-asserts startCoordinator() for each, so a
// loop that died (e.g. cleared by a crash recovery path) is respawned on the
// next sweep. The daemon is safe to leave always-on — it only ever claims todos
// already in `ready`, which only the Planner sets post-approval, so an empty
// ready-queue idles. An explicit stopCoordinator() opts a project back out.
const autoManaged = new Map<string, number>(); // project → intervalMs
let watchdog: ReturnType<typeof setInterval> | null = null;
const WATCHDOG_INTERVAL_MS = 30_000;

function maybeStopWatchdog(): void {
  if (autoManaged.size === 0 && watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

function ensureWatchdog(): void {
  if (watchdog) return;
  const w = setInterval(() => {
    for (const [project, intervalMs] of autoManaged) {
      // Idempotent: startCoordinator returns false (no-op) if already running,
      // and respawns the loop if it had died.
      startCoordinator(project, intervalMs);
    }
  }, WATCHDOG_INTERVAL_MS);
  (w as { unref?: () => void }).unref?.();
  watchdog = w;
}

/** Start a coordinator for `project` and keep it always-on: it is respawned by
 *  a watchdog if its loop ever dies. Idempotent. Returns whether the loop was
 *  (re)started by this call. */
export function autoStartCoordinator(project: string, intervalMs = 30_000): boolean {
  autoManaged.set(project, intervalMs);
  ensureWatchdog();
  return startCoordinator(project, intervalMs);
}

/** True if `project` is registered for always-on auto-respawn. */
export function isCoordinatorAutoManaged(project: string): boolean {
  return autoManaged.has(project);
}
