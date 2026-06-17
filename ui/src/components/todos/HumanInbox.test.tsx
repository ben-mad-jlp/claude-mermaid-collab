import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HumanInbox } from './HumanInbox';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: null,
    title: p.id,
    description: null,
    status: 'ready',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    // De-conflated model (epic b2c858d4): inbox membership/actionability is
    // DERIVED from approvedAt/heldAt/claim, not the legacy status enum. These
    // fixtures represent approved, unblocked human work by default.
    approvedAt: '2026-06-16T00:00:00Z',
    heldAt: null,
    claim: null,
    ...p,
  } as SessionTodo;
}

describe('HumanInbox', () => {
  it('renders only the human inbox items and a calm empty state otherwise', () => {
    const { rerender } = render(<HumanInbox todos={[todo({ id: 'a1', assigneeKind: 'agent' })]} />);
    expect(screen.getByTestId('human-inbox').getAttribute('data-count')).toBe('0');
    expect(screen.getByText(/nothing assigned to you/i)).toBeTruthy();

    rerender(
      <HumanInbox
        todos={[todo({ id: 'h1', title: 'Review batch', assigneeKind: 'human', status: 'ready' })]}
      />,
    );
    expect(screen.getByTestId('human-inbox').getAttribute('data-count')).toBe('1');
    expect(screen.getByText('Review batch')).toBeTruthy();
  });

  it('fires onClaim for a ready item and onComplete for an in-progress item', () => {
    const onClaim = vi.fn();
    const onComplete = vi.fn();
    render(
      <HumanInbox
        todos={[
          todo({ id: 'ready1', assigneeKind: 'human', status: 'ready' }),
          todo({
            id: 'inflight1',
            assigneeKind: 'human',
            status: 'in_progress',
            claim: { by: 'me', token: 't', at: '2026-06-16T00:00:00Z', leaseMs: 60000 },
          }),
        ]}
        onClaim={onClaim}
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByTestId('human-inbox-claim'));
    fireEvent.click(screen.getByTestId('human-inbox-complete'));
    expect(onClaim).toHaveBeenCalledWith(expect.objectContaining({ id: 'ready1' }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'inflight1' }));
  });

  it('deep-links via the link chip when the todo carries a link', () => {
    const onOpen = vi.fn();
    render(
      <HumanInbox
        todos={[
          todo({
            id: 'h1',
            assigneeKind: 'human',
            status: 'ready',
            link: { blueprintId: 'annotate-batch-7' },
          }),
        ]}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByTestId('human-inbox-open'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }));
  });

  it('shows no link chip when the todo has no link', () => {
    render(<HumanInbox todos={[todo({ id: 'h1', assigneeKind: 'human', status: 'ready' })]} />);
    expect(screen.queryByTestId('human-inbox-open')).toBeNull();
  });
});
