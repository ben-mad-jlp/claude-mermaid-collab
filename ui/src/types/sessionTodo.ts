export interface SessionTodoLink { blueprintId: string; taskId?: string }

export interface SessionTodo {
  id: number;
  text: string;
  completed: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  link?: SessionTodoLink;
}
