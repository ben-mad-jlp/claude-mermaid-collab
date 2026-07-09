/**
 * StrandedPanel tests — `dep-dropped` and `deps-pending` are two dependency-gated states
 * that must render as structurally distinct affordances (a `STRANDED` badge + struck
 * dead-dep chip vs a plain `waiting on N` chip), not merely differ by tooltip text.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrandedPanel } from '../StrandedPanel';
import { claimReason, buildById } from '@/lib/claimability';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(id: string, over: Record<string, unknown> = {}): SessionTodo {
  return {
    id, title: `Todo ${id}`, status: 'planned', kind: 'leaf', parentId: 'epic-1',
    approvedAt: '2026-01-01T00:00:00Z', priority: null, order: 0, retryCount: 0,
    ...over,
  } as unknown as SessionTodo;
}

const depDropped = todo('dep-dropped-1', { status: 'dropped' });
const depLive = todo('dep-live-001', { approvedAt: null });
const strandedTodo = todo('stranded-01', { dependsOn: ['dep-dropped-1'] });
const pendingTodo = todo('pending-001', { dependsOn: ['dep-live-001'] });

const todos = [depDropped, depLive, strandedTodo, pendingTodo];

describe('StrandedPanel — dep-dropped vs deps-pending affordances', () => {
  it('fixture is pinned to the shared claimReason predicate', () => {
    const byId = buildById(todos);
    expect(claimReason(byId.get('stranded-01')!, byId)).toBe('dep-dropped');
    expect(claimReason(byId.get('pending-001')!, byId)).toBe('deps-pending');
  });

  it('renders the two states as structurally distinct affordances', () => {
    render(<StrandedPanel todos={todos} />);

    expect(screen.getByText(/1 stranded/)).toBeTruthy();
    expect(screen.getByText(/1 waiting on live work/)).toBeTruthy();
    expect(screen.getAllByText('STRANDED')).toHaveLength(1);
    expect(screen.getByText('dep-drop')).toBeTruthy();
    expect(screen.getByText('waiting on 1')).toBeTruthy();
    expect(screen.getByText(/Needs a human/)).toBeTruthy();

    const strandedButton = screen.getByText('Todo stranded-01').closest('button');
    const waitingButton = screen.getByText('Todo pending-001').closest('button');
    expect(strandedButton).not.toBe(waitingButton);
    expect(strandedButton?.textContent).toContain('STRANDED');
    expect(waitingButton?.textContent).not.toContain('STRANDED');
  });

  it('renders the empty state when nothing is stranded or waiting', () => {
    render(<StrandedPanel todos={[depDropped, depLive]} />);
    expect(screen.getByText(/Nothing stranded/)).toBeTruthy();
  });
});
