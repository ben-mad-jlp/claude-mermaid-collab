/**
 * ReadyPanel tests — when the daemon's authoritative claimableIds are passed, the panel
 * shows EXACTLY that set (so it agrees with the Ready tab count), instead of the local
 * isClaimable() predicate which over-counts (it can't run the daemon's probe/git/headless/
 * breaker gates).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadyPanel } from './ReadyPanel';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(id: string, over: Record<string, unknown> = {}): SessionTodo {
  return {
    id, title: `Todo ${id}`, status: 'planned', parentId: 'epic-1',
    priority: null, order: 0, retryCount: 0,
    ...over,
  } as unknown as SessionTodo;
}

describe('ReadyPanel — daemon claimableIds authority', () => {
  it('shows EXACTLY the daemon claimableIds set when provided (not the local predicate)', () => {
    const todos = [todo('a'), todo('b'), todo('c'), todo('d')];
    render(<ReadyPanel todos={todos} claimableIds={['a', 'c']} />);
    expect(screen.getByText(/2 ready/)).toBeTruthy();
    expect(screen.getByText('Todo a')).toBeTruthy();
    expect(screen.getByText('Todo c')).toBeTruthy();
    expect(screen.queryByText('Todo b')).toBeNull();
    expect(screen.queryByText('Todo d')).toBeNull();
  });

  it('renders the empty state when claimableIds is an empty set', () => {
    const todos = [todo('a'), todo('b')];
    render(<ReadyPanel todos={todos} claimableIds={[]} />);
    expect(screen.getByText(/Nothing ready/)).toBeTruthy();
  });
});
