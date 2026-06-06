/**
 * Stable per-(project, session/lane, todo) bsync session_id (SEAM·both).
 *
 * bsync (build123d) defaults every call to session_id="default" — an in-memory,
 * project-less assembly. Two collab CAD workers both routing to "default" would
 * STOMP each other's live assembly (the #1 blocker for parallel CAD through
 * collab). The fix: derive a STABLE, UNIQUE bsync session_id from
 * (project, collab-session/lane, todo) at worker-spawn time and instruct the
 * worker (via its injected context prompt) to pass that session_id on EVERY
 * bsync MCP call. Each concurrent worker then operates on an isolated bsync
 * session and they no longer corrupt each other's assembly.
 *
 * - STABLE: same (project, session, todo) always hashes to the same id, so a
 *   reclaimed/re-spawned worker reattaches to the SAME bsync session on resume
 *   instead of starting a fresh empty assembly.
 * - UNIQUE: two concurrent workers differ in lane and/or todo, so their derived
 *   ids differ — no collision, no stomp.
 *
 * This module is pure (hash + string building); the coordinator wires it into
 * the worker spawn (launchWorker) by appending the context note to the worker's
 * contextPrompt for CAD todos.
 */
import { createHash } from 'node:crypto';
import type { Todo } from './todo-store';

/** Prefix marking a bsync session as collab-owned (vs bsync's own "default"). */
export const BSYNC_SESSION_PREFIX = 'collab-';

/**
 * Derive a stable, unique bsync session_id from the routing identity of a
 * worker. The triple (project, session/lane, todoId) is exactly what makes a
 * worker's bsync work distinct AND reproducible: project+lane keep concurrent
 * lanes apart, the todo keeps sequential todos in the same lane apart, and the
 * whole triple is deterministic so a resume re-derives the same id.
 *
 * Returns `collab-<16-hex>` (sha1, truncated — matching the existing hashing
 * convention in permission-bridge). The bsync server keys its in-memory session
 * map by this bare string.
 */
export function deriveBsyncSessionId(project: string, session: string, todoId: string): string {
  const sha = createHash('sha1').update(`${project}\n${session}\n${todoId}`).digest('hex').slice(0, 16);
  return `${BSYNC_SESSION_PREFIX}${sha}`;
}

/**
 * A todo whose deliverable is CAD geometry (type === 'cad'). Only CAD todos need
 * the bsync isolation note; non-CAD workers never touch bsync.
 */
export function isCadTodo(todo: Pick<Todo, 'type'>): boolean {
  return todo.type === 'cad';
}

/**
 * The context-prompt fragment appended to a CAD worker's system prompt. It tells
 * the worker to route every bsync call through its isolated session_id and never
 * fall back to bsync's shared "default".
 */
export function bsyncSessionContextNote(bsyncSessionId: string): string {
  return (
    `\n\nBSYNC SESSION ISOLATION: you share the bsync (build123d) server with other ` +
    `concurrent CAD workers. To avoid stomping their live assembly, pass ` +
    `session_id="${bsyncSessionId}" on EVERY bsync / build123d MCP call (run_script, ` +
    `create_primitive, add_part_step, add_connection, analyze_dof, check_clearance, ` +
    `validate_geometry, mass_properties, export/step_save, etc.). NEVER use the default ` +
    `bsync session. This id is stable for this todo, so on a resume reuse the SAME ` +
    `session_id="${bsyncSessionId}" to reattach to your existing assembly.`
  );
}
