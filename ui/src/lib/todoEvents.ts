/**
 * Predicate for the `session_todos_updated` WS event: should the current
 * session's UI refetch its todo list? True when the event is for this project
 * AND this session is involved — as the acting session, the owner, the new
 * assignee, OR the PREVIOUS assignee. The assignee case is what makes
 * cross-session assignment live (a manager assigning a todo to me must refresh
 * my list); the previous-assignee case makes a re-assignment AWAY from me clear
 * it from my list.
 */
export interface TodoEventCtx {
  project: string;
  session: string;
}

export interface TodoUpdatedEvent {
  type: 'session_todos_updated';
  project: string;
  session: string; // the acting/owner session the event was emitted for
  ownerSession?: string;
  assigneeSession?: string;
  previousAssigneeSession?: string;
}

export function shouldRefetchTodos(evt: TodoUpdatedEvent, ctx: TodoEventCtx): boolean {
  if (evt.type !== 'session_todos_updated') return false;
  if (evt.project !== ctx.project) return false;
  return (
    evt.session === ctx.session ||
    evt.ownerSession === ctx.session ||
    evt.assigneeSession === ctx.session ||
    evt.previousAssigneeSession === ctx.session
  );
}
