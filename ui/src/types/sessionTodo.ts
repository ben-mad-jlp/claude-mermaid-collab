export type TodoStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done';

export interface SessionTodoLink { blueprintId: string; taskId?: string }

export interface SessionTodo {
  id: string; // was number — now a UUID
  ownerSession: string;
  assigneeSession: string | null;
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
}
