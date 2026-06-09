/**
 * Unified session-runtime READ MODEL (refactor C3, design
 * `design-session-runtime-read-model`).
 *
 * "Who is alive and what are they doing" is fragmented across three stores plus
 * in-memory pool state, and every consumer (supervisor reconcile, the
 * self-watchdog, the FleetGraph feed, the WorkerRoster) re-implements the same
 * join — which drifts. This module is the ONE join: it reads
 *   - session-status.db  → status / contextPercent / checkpointReadyAt
 *   - todos.db           → the active claim (what a worker is doing)
 *   - supervisor.db      → identity (role / isSupervisor) + open escalations
 *   - worker-pool (mem)  → slot tmux (Increment 2 makes this durable)
 * and exposes a single `SessionRuntime` shape with ONE `deriveLiveness`.
 *
 * This is a READ model, NOT a storage merge: the stores keep distinct ownership
 * of claims / status / identity. No schema change.
 *
 * Pure core (`buildSessionRuntimes`) takes already-fetched rows so it is
 * unit-testable over fixtures with a fake clock; the thin wrappers
 * (`listSessionRuntimes` / `getSessionRuntime`) wire the real stores. This
 * mirrors the inject-the-I/O pattern in context-watchdog.ts.
 */

import { getStatuses, type SessionStatusRow, type ClaudeStatus } from './session-status-store.js';
import { listTodos, type Todo } from './todo-store.js';
import * as supervisorStore from './supervisor-store.js';
import { listPool } from './worker-pool.js';

export type Liveness = 'active' | 'idle' | 'crashed';

/** No status heartbeat for this long ⇒ a session still holding a claim reads as
 *  `crashed`. Kept in lockstep with the UI's `CRASH_MS` (ui/src/lib/liveness.ts);
 *  this is the canonical value. */
export const CRASH_MS = 120_000;

/**
 * The single unified runtime view of one session, joining all three stores.
 * `updatedAt` is the session-status heartbeat (drives liveness); the in-memory
 * `slotTmux` / `idleSince` become durable in Increment 2.
 */
export interface SessionRuntime {
  project: string;
  session: string;
  /** Role derived from the session-name prefix (`backend-2` → `backend`). */
  role: string;
  /** True when this session is the registered supervisor for its project. */
  isSupervisor: boolean;
  status: ClaudeStatus;
  /** Last session-status heartbeat (ms epoch) — the liveness clock. */
  updatedAt: number;
  contextPercent: number | null;
  contextUpdatedAt: number | null;
  checkpointReadyAt: number | null;
  /** Id of the in-progress todo this session has claimed (or is assignee of). */
  claimedTodoId: string | null;
  claimedAt: string | null;
  retryCount: number;
  /** tmux base name of the worker-pool slot backing this session, if any. */
  slotTmux: string | null;
  /** Best-effort: when the session went idle (= its last heartbeat) while not
   *  active; null while active. Increment 2 replaces this with durable tracking. */
  idleSince: number | null;
  /** True when an open escalation references this session. */
  escalated: boolean;
  liveness: Liveness;
}

/**
 * Derive a session's liveness — the ONE definition (the UI mirrors this). A stale
 * session that still holds a claim reads as `crashed` (the dangerous case); a
 * fresh `active` heartbeat is `active`; everything else is `idle`.
 */
export function deriveLiveness(
  input: { status: string; updatedAt: number },
  hasActiveClaim: boolean,
  now: number,
): Liveness {
  const stale = now - input.updatedAt > CRASH_MS;
  if (stale && hasActiveClaim) return 'crashed';
  if (input.status === 'active') return 'active';
  return 'idle';
}

/** Role badge derived from the session-name prefix. */
export function roleOf(session: string): string {
  return session.split(/[-_]/)[0]?.toLowerCase() ?? '';
}

/** Already-fetched inputs to the pure join — one per source store. */
export interface RuntimeSources {
  statuses: SessionStatusRow[];
  /** In-progress todos for the project (the only ones that carry a live claim). */
  inProgressTodos: Pick<Todo, 'id' | 'claimedBy' | 'assigneeSession' | 'claimedAt' | 'retryCount'>[];
  /** The supervisor's session IF its identity is for THIS project, else null. */
  supervisorSession: string | null;
  /** Sessions in this project with an open escalation. */
  escalatedSessions: Set<string>;
  /** session → slot tmux (from the in-memory worker pool). */
  slotTmuxBySession: Map<string, string>;
  now: number;
}

/**
 * The active claim a session holds: the in-progress todo claimed by OR assigned
 * to it. Mirrors the UI's `currentTodoFor` (a terminal todo never counts — only
 * in-progress claims are passed in).
 */
function claimFor(
  session: string,
  todos: RuntimeSources['inProgressTodos'],
): RuntimeSources['inProgressTodos'][number] | null {
  return todos.find((t) => t.claimedBy === session || t.assigneeSession === session) ?? null;
}

/** Pure join: build one SessionRuntime from already-fetched rows. */
export function buildSessionRuntime(
  project: string,
  status: SessionStatusRow,
  src: RuntimeSources,
): SessionRuntime {
  const claim = claimFor(status.session, src.inProgressTodos);
  const liveness = deriveLiveness(status, claim != null, src.now);
  return {
    project,
    session: status.session,
    role: roleOf(status.session),
    isSupervisor: src.supervisorSession === status.session,
    status: status.status,
    updatedAt: status.updatedAt,
    contextPercent: status.contextPercent,
    contextUpdatedAt: status.contextUpdatedAt,
    checkpointReadyAt: status.checkpointReadyAt,
    claimedTodoId: claim?.id ?? null,
    claimedAt: claim?.claimedAt ?? null,
    retryCount: claim?.retryCount ?? 0,
    slotTmux: src.slotTmuxBySession.get(status.session) ?? null,
    idleSince: status.status === 'active' ? null : status.updatedAt,
    escalated: src.escalatedSessions.has(status.session),
    liveness,
  };
}

/** Pure join over all status rows. */
export function buildSessionRuntimes(project: string, src: RuntimeSources): SessionRuntime[] {
  return src.statuses.map((s) => buildSessionRuntime(project, s, src));
}

/** Read the live sources for a project from the three stores + the worker pool. */
function readSources(project: string, now: number): RuntimeSources {
  const statuses = getStatuses(project);
  const inProgressTodos = listTodos(project, { includeCompleted: false }).filter(
    (t) => t.status === 'in_progress',
  );
  const identity = supervisorStore.getSupervisorIdentity();
  const supervisorSession = identity && identity.project === project ? identity.session : null;
  const escalatedSessions = new Set(
    supervisorStore.listOpenEscalations().filter((e) => e.project === project).map((e) => e.session),
  );
  const slotTmuxBySession = new Map<string, string>();
  for (const [session, slot] of Object.entries(listPool())) {
    if (slot.tmux) slotTmuxBySession.set(session, slot.tmux);
  }
  return { statuses, inProgressTodos, supervisorSession, escalatedSessions, slotTmuxBySession, now };
}

/** Unified runtime for every session known to a project's session-status store. */
export function listSessionRuntimes(project: string, now: number = Date.now()): SessionRuntime[] {
  return buildSessionRuntimes(project, readSources(project, now));
}

/** Unified runtime for one session, or null if it has no session-status row. */
export function getSessionRuntime(
  project: string,
  session: string,
  now: number = Date.now(),
): SessionRuntime | null {
  const src = readSources(project, now);
  const status = src.statuses.find((s) => s.session === session);
  return status ? buildSessionRuntime(project, status, src) : null;
}
