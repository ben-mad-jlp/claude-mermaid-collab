/**
 * Project-scoped nudge target resolver — find the most-recently-updated conductor-role session
 * for a project, or fall back to the canonical CONDUCTOR_SESSION literal.
 *
 * This module replaces per-mission ownerSession/assigneeSession with a project-level resolution:
 * every nudge to a conductor for a mission goes to the SAME session per project (the active one),
 * not a fragmented routing based on disconnected mission fields.
 */

import { getStatuses, type SessionStatusRow } from './session-status-store.js';
import { roleOf } from './session-runtime.js';

export const CONDUCTOR_SESSION = 'conductor';

/**
 * Resolve the nudge target for a project: the session to nudge when a mission needs motion.
 * Returns the `session` of the conductor-role status row with the greatest `updatedAt`;
 * if none match, returns CONDUCTOR_SESSION. Fails open (any store error → CONDUCTOR_SESSION).
 */
export function resolveNudgeTarget(project: string, deps?: { getStatuses?: typeof getStatuses }): string {
  try {
    const statuses = (deps?.getStatuses ?? getStatuses)(project);
    const conductors = statuses.filter((row) => roleOf(row.session) === 'conductor');
    if (conductors.length === 0) return CONDUCTOR_SESSION;
    const mostRecent = conductors.reduce((best, current) =>
      current.updatedAt > best.updatedAt ? current : best
    );
    return mostRecent.session;
  } catch {
    return CONDUCTOR_SESSION;
  }
}
