/**
 * RequirementsInbox — the P0 confirm-loop heartbeat. Proves the inbox lists the
 * project's awaiting-signature promises and that the keyboard drain
 * (1/↵ approve · e edit · 3 reject) calls decideRequirement with the right
 * decision, plus the changed-card was→now DIFF and silent empty state.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Requirement } from '@/stores/supervisorStore';

const decideRequirement = vi.fn().mockResolvedValue(true);

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: { decideRequirement: typeof decideRequirement }) => unknown) =>
    sel({ decideRequirement }),
}));

import { RequirementsInbox } from './RequirementsInbox';

function req(p: Partial<Requirement>): Requirement {
  return {
    id: p.id ?? 'r1',
    project: 'P',
    epicId: null,
    kind: 'performance',
    status: 'proposed',
    title: 'latency',
    rationale: null,
    spec: { metric: 'latency', op: '<=', target: 150 },
    supersededBy: null,
    linkedTodos: [],
    approvedBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...p,
  };
}

beforeEach(() => decideRequirement.mockClear());

describe('RequirementsInbox', () => {
  it('lists the project inbox promises and renders the chip', () => {
    render(<RequirementsInbox requirements={[req({ id: 'a' })]} project="P" serverScope="local" />);
    const inbox = screen.getByTestId('requirements-inbox');
    expect(inbox.getAttribute('data-proposed')).toBe('1');
    expect(screen.getByTestId('requirement-chip')).toHaveTextContent('latency · <= · 150');
  });

  it('renders nothing when the inbox is empty (silent)', () => {
    render(<RequirementsInbox requirements={[req({ status: 'approved' })]} project="P" serverScope="local" />);
    expect(screen.queryByTestId('requirements-inbox')).toBeNull();
  });

  it('approves the active card on "1"', () => {
    render(<RequirementsInbox requirements={[req({ id: 'a' })]} project="P" serverScope="local" />);
    fireEvent.keyDown(window, { key: '1' });
    expect(decideRequirement).toHaveBeenCalledWith('local', 'P', 'a', 'approve');
  });

  it('approves the active card on Enter', () => {
    render(<RequirementsInbox requirements={[req({ id: 'a' })]} project="P" serverScope="local" />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(decideRequirement).toHaveBeenCalledWith('local', 'P', 'a', 'approve');
  });

  it('rejects the active card on "3"', () => {
    render(<RequirementsInbox requirements={[req({ id: 'a' })]} project="P" serverScope="local" />);
    fireEvent.keyDown(window, { key: '3' });
    expect(decideRequirement).toHaveBeenCalledWith('local', 'P', 'a', 'reject');
  });

  it('opens the edit composer on "e" and commits a re-sign', () => {
    render(<RequirementsInbox requirements={[req({ id: 'a' })]} project="P" serverScope="local" />);
    fireEvent.keyDown(window, { key: 'e' });
    expect(screen.getByTestId('requirement-edit-composer')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('target'), { target: { value: '120' } });
    fireEvent.keyDown(screen.getByLabelText('target'), { key: 'Enter' });
    expect(decideRequirement).toHaveBeenCalledWith('local', 'P', 'a', 'edit', {
      spec: { metric: 'latency', op: '<=', target: 120 },
    });
  });

  it('shows the was→now DIFF for a changed card', () => {
    const old = req({ id: 'old', status: 'approved', supersededBy: 'new', spec: { metric: 'latency', op: '<=', target: 200 } });
    const fresh = req({ id: 'new', status: 'changed', spec: { metric: 'latency', op: '<=', target: 150 } });
    render(<RequirementsInbox requirements={[old, fresh]} project="P" serverScope="local" />);
    expect(screen.getByText(/CHANGED/)).toBeInTheDocument();
    expect(screen.getByText(/latency · <= · 200/)).toBeInTheDocument();
  });
});
