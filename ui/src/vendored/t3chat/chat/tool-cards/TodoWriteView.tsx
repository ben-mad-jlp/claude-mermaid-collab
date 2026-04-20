import * as React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import { cn } from '../../lib/utils';

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface Todo {
  content: string;
  status: TodoStatus;
}

export interface TodoWriteViewProps {
  item: AgentToolCallItem;
}

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '✓',
};

export const TodoWriteView: React.FC<TodoWriteViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as { todos?: Todo[] };
  const todos = Array.isArray(input.todos) ? input.todos : [];

  if (todos.length === 0) {
    return <div className="text-xs text-muted-foreground italic">No todos</div>;
  }

  return (
    <div data-testid="todo-write-view">
      <ul className="flex flex-col gap-1 text-xs">
        {todos.map((todo, idx) => {
          const status: TodoStatus = todo.status ?? 'pending';
          const inProgress = status === 'in_progress';
          const completed = status === 'completed';
          return (
            <li
              key={idx}
              data-testid={`todo-item-${idx}`}
              data-status={status}
              className={cn(
                'flex items-start gap-2 leading-5',
                inProgress && 'font-semibold text-primary',
                completed && 'line-through text-muted-foreground',
                !inProgress && !completed && 'text-foreground',
              )}
            >
              <span aria-hidden="true" className="font-mono w-4 flex-shrink-0 text-center">
                {STATUS_ICON[status]}
              </span>
              <span className="flex-1 break-words">{todo.content}</span>
            </li>
          );
        })}
      </ul>
      {item.error ? <div className="mt-2 text-xs text-destructive">{item.error}</div> : null}
    </div>
  );
};

export default TodoWriteView;
