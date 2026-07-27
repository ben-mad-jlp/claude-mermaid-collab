/**
 * NeedsYouZone (Z1) — renders the open escalations as cards, scoped by the P1
 * selector, with a calm-tick empty state. Proves the zone shows exactly the
 * same open set the badge/ring derive from (project + status==='open').
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NeedsYouZone } from './NeedsYouZone';
import type { Escalation } from '@/stores/supervisorStore';

function esc(p: Partial<Escalation>): Escalation {
  return {
    id: p.id ?? 'e1',
    project: 'P',
    session: 'worker-1',
    kind: 'decision',
    questionText: 'pick one',
    status: 'open',
    createdAt: 1,
    ...p,
  } as Escalation;
}

describe('NeedsYouZone', () => {
  it('renders the inbox cards for open escalations in this project', () => {
    const escalations = [esc({ id: 'e1', project: 'P', status: 'open', questionText: 'deploy now?' })];
    render(<NeedsYouZone escalations={escalations} project="P" serverScope="local" embedded />);
    const zone = screen.getByTestId('needs-you-zone');
    expect(zone).toBeInTheDocument();
    expect(zone.getAttribute('data-needs-you')).toBe('1');
    expect(screen.getByTestId('bridge-escalation-inbox')).toBeInTheDocument();
    expect(screen.getByText('deploy now?')).toBeInTheDocument();
  });

  it('shows the calm tick and no inbox when there is nothing open', () => {
    const escalations = [esc({ id: 'e1', project: 'P', status: 'resolved' })];
    render(<NeedsYouZone escalations={escalations} project="P" serverScope="local" embedded />);
    expect(screen.getByTestId('needs-you-zone').getAttribute('data-needs-you')).toBe('0');
    expect(screen.queryByTestId('bridge-escalation-inbox')).toBeNull();
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();
  });

  it('excludes escalations from other projects (selector scope)', () => {
    const escalations = [esc({ id: 'e1', project: 'OTHER', status: 'open' })];
    render(<NeedsYouZone escalations={escalations} project="P" serverScope="local" embedded />);
    expect(screen.getByTestId('needs-you-zone').getAttribute('data-needs-you')).toBe('0');
    expect(screen.queryByTestId('bridge-escalation-inbox')).toBeNull();
  });

  it('shows machine-items-handled count for mixed-kind escalations', () => {
    const escalations = [
      esc({ id: 'e1', project: 'P', status: 'open', kind: 'decision', questionText: 'deploy?' }),
      esc({ id: 'e2', project: 'P', status: 'open', kind: 'blocker', questionText: 'fix leak?' }),
      esc({ id: 'e3', project: 'P', status: 'open', kind: 'epic-sweep-triage' }),
      esc({ id: 'e4', project: 'P', status: 'open', kind: 'infra-park' }),
      esc({ id: 'e5', project: 'P', status: 'open', kind: 'leaf-infra-rejected' }),
    ];
    render(<NeedsYouZone escalations={escalations} project="P" serverScope="local" embedded />);
    const zone = screen.getByTestId('needs-you-zone');
    expect(zone.getAttribute('data-needs-you')).toBe('2');
    expect(screen.getByText('deploy?')).toBeInTheDocument();
    expect(screen.getByText('fix leak?')).toBeInTheDocument();
    expect(screen.getByTestId('machine-items-handled')).toHaveTextContent('3 machine items handled');
  });

  it('hides machine-items-handled when count is zero', () => {
    const escalations = [esc({ id: 'e1', project: 'P', status: 'open', kind: 'decision', questionText: 'go?' })];
    render(<NeedsYouZone escalations={escalations} project="P" serverScope="local" embedded />);
    expect(screen.getByTestId('needs-you-zone').getAttribute('data-needs-you')).toBe('1');
    expect(screen.queryByTestId('machine-items-handled')).toBeNull();
  });
});
