import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TodoWriteView from '../TodoWriteView';
import type { AgentToolCallItem } from '@/stores/agentStore';

function makeItem(todos: Array<{ content: string; status: string }>): AgentToolCallItem {
  return {
    input: { todos },
  } as unknown as AgentToolCallItem;
}

describe('TodoWriteView', () => {
  it('renders all todos from input', () => {
    const item = makeItem([
      { content: 'First task', status: 'pending' },
      { content: 'Second task', status: 'in_progress' },
      { content: 'Third task', status: 'completed' },
    ]);
    render(<TodoWriteView item={item} />);
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('Second task')).toBeInTheDocument();
    expect(screen.getByText('Third task')).toBeInTheDocument();
  });

  it('highlights in_progress todos with bold and accent color', () => {
    const item = makeItem([
      { content: 'Active work', status: 'in_progress' },
    ]);
    render(<TodoWriteView item={item} />);
    const li = screen.getByTestId('todo-item-0');
    expect(li.className).toMatch(/font-bold/);
    expect(li.className).toMatch(/text-blue/);
    expect(li.getAttribute('data-status')).toBe('in_progress');
  });

  it('strikes through completed todos', () => {
    const item = makeItem([
      { content: 'Done task', status: 'completed' },
    ]);
    render(<TodoWriteView item={item} />);
    const li = screen.getByTestId('todo-item-0');
    expect(li.className).toMatch(/line-through/);
    expect(li.getAttribute('data-status')).toBe('completed');
  });

  it('renders empty state when no todos provided', () => {
    const item = { input: {} } as unknown as AgentToolCallItem;
    render(<TodoWriteView item={item} />);
    expect(screen.getByText(/no todos/i)).toBeInTheDocument();
  });

  it('pending todos are neither bold nor struck through', () => {
    const item = makeItem([{ content: 'Waiting', status: 'pending' }]);
    render(<TodoWriteView item={item} />);
    const li = screen.getByTestId('todo-item-0');
    expect(li.className).not.toMatch(/font-bold/);
    expect(li.className).not.toMatch(/line-through/);
  });
});
