/** Mission subscription lifecycle — sync ownership state to subscription DB.
 *
 * Ownership of a mission IS the statement of interest: the owning session is
 * auto-subscribed at mission scope on activation and unsubscribed when the mission
 * is deactivated / converged / stopped / deleted. A conductor that must remember to
 * subscribe will forget, and the failure is silent (no nudge ever arrives).
 */

import { getTodo } from './todo-store.js';
import { getMission, isMissionTerminal } from './mission-store.js';
import { addSubscription, removeSubscription } from './session-subscriptions.js';

/** Sync mission ownership to subscription state: subscribe owner when active+non-terminal,
 *  else unsubscribe. Idempotent. Returns the action taken: 'subscribed' | 'unsubscribed' | 'noop'. */
export function syncMissionSubscription(project: string, todoId: string): 'subscribed' | 'unsubscribed' | 'noop' {
  const m = getMission(project, todoId);
  const node = getTodo(project, todoId);
  const ownerSession = node?.ownerSession ?? node?.assigneeSession ?? null;

  if (!ownerSession) return 'noop';

  if (m && m.active && !isMissionTerminal(m)) {
    addSubscription(project, ownerSession, 'mission', todoId);
    return 'subscribed';
  } else {
    removeSubscription(project, ownerSession, 'mission', todoId);
    return 'unsubscribed';
  }
}

/** Remove a mission subscription for a specific owner session.
 *  Used by delete_mission when the mission node is already gone. */
export function unsubscribeMission(project: string, todoId: string, session: string): boolean {
  return removeSubscription(project, session, 'mission', todoId);
}
