// Mirrors the backend unified work-graph (src/services/todo-store.ts).
// `planned`/`ready`/`dropped` are work-graph states the Planner/Coordinator use.
export type TodoStatus = 'backlog' | 'planned' | 'todo' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'dropped';

export interface SessionTodoLink { blueprintId: string; taskId?: string }

export interface SessionTodo {
  id: string; // was number — now a UUID
  ownerSession: string;
  assigneeSession: string | null;
  /** Agent (default) vs human assignee — attribution, not auth (B1). Optional for
   *  back-compat with payloads written before the field existed. */
  assigneeKind?: 'agent' | 'human';
  title: string; // replaces `text`
  /** @deprecated use `title` — kept so existing components compile until todo-ui-views updates them */
  text?: string;
  description: string | null;
  status: TodoStatus;
  completed: boolean; // derived (status === 'done'); kept for back-compat toggle logic
  priority: 0 | 1 | 2 | 3 | 4 | null;
  dueDate: string | null;
  parentId: string | null;
  dependsOn: string[];
  order: number;
  link: SessionTodoLink | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  asanaGid: string | null;
  // Work-graph fields (PCS) — present on unified todos; optional for back-compat.
  sessionName?: string | null;
  kind?: string | null;
  acceptanceStatus?: 'pending' | 'accepted' | 'rejected' | null;
  claimedBy?: string | null;
  retryCount?: number;
  /** Opaque actor handle recorded when a HUMAN todo is completed (B1). */
  completedBy?: string | null;
}
