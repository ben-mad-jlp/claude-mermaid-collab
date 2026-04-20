import React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';

type TodoStatus = 'pending' | 'in_progress' | 'completed';

interface Todo {
  content: string;
  status: TodoStatus;
}

interface TodoWriteViewProps {
  item: AgentToolCallItem;
}

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '✓',
};

const TodoWriteView: React.FC<TodoWriteViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as { todos?: Todo[] };
  const todos = Array.isArray(input.todos) ? input.todos : [];

  if (todos.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic">No todos</div>
    );
  }

  return (
    <div data-testid="todo-write-view">
      <ul className="flex flex-col gap-1 text-xs">
        {todos.map((todo, idx) => {
          const status: TodoStatus = todo.status ?? 'pending';
          const isInProgress = status === 'in_progress';
          const isCompleted = status === 'completed';

          const itemClass = [
            'flex items-start gap-2 leading-5',
            isInProgress ? 'font-bold text-blue-600' : '',
            isCompleted ? 'line-through text-gray-400' : '',
            !isInProgress && !isCompleted ? 'text-gray-800' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li
              key={idx}
              className={itemClass}
              data-testid={`todo-item-${idx}`}
              data-status={status}
            >
              <span
                aria-hidden="true"
                className="font-mono w-4 flex-shrink-0 text-center"
              >
                {STATUS_ICON[status]}
              </span>
              <span className="flex-1 break-words">{todo.content}</span>
            </li>
          );
        })}
      </ul>
      {item.error ? (
        <div className="mt-2 text-xs text-red-600">{item.error}</div>
      ) : null}
    </div>
  );
};

export default TodoWriteView;
