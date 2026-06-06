import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConstraintPeerChips } from './ConstraintPeerChips';
import { useSupervisorStore, type Requirement } from '@/stores/supervisorStore';

function req(p: Partial<Requirement> & { id: string }): Requirement {
  return {
    id: p.id,
    project: '/p',
    epicId: null,
    kind: 'requirement',
    status: 'active',
    title: p.id,
    spec: null,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  } as Requirement;
}

function seed(requirements: Requirement[]) {
  useSupervisorStore.setState({
    requirementsByProject: { '/p': requirements },
    loadRequirements: async () => {},
  } as any);
}

describe('ConstraintPeerChips', () => {
  beforeEach(() => seed([]));

  it('renders nothing when there are no confirmed requirements (calm absence)', () => {
    seed([req({ id: 'p1', status: 'proposed' })]); // inbox state, not a peer chip
    const { container } = render(<ConstraintPeerChips serverId="local" project="/p" />);
    expect(screen.queryByTestId('constraint-peer-chips')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('renders confirmed (approved/active) requirements as peer chips, excluding inbox + superseded', () => {
    seed([
      req({ id: 'active1', status: 'active', spec: { metric: 'p95_latency_ms', op: '<=', target: 200 } }),
      req({ id: 'approved1', status: 'approved', title: 'No PII in logs' }),
      req({ id: 'proposed1', status: 'proposed' }), // inbox — excluded
      req({ id: 'gone1', status: 'active', supersededBy: 'x' }), // superseded — excluded
    ]);
    render(<ConstraintPeerChips serverId="local" project="/p" />);
    const row = screen.getByTestId('constraint-peer-chips');
    expect(row.getAttribute('data-count')).toBe('2');
    // The machine spec renders as metric · op · target; the spec-less one falls back to title.
    expect(screen.getByText('p95_latency_ms · <= · 200')).toBeTruthy();
    expect(screen.getByText('No PII in logs')).toBeTruthy();
    expect(screen.queryByText('proposed1')).toBeNull();
    expect(screen.queryByText('gone1')).toBeNull();
  });
});
