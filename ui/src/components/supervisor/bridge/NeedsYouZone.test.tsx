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
    render(<NeedsYouZone escalations={escalations} project="P" serverScope="local" />);
    const zone = screen.getByTestId('needs-you-zone');
    expect(zone).toBeInTheDocument();
    expect(zone.getAttribute('data-needs-you')).toBe('1');
    expect(screen.getByTestId('bridge-escalation-inbox')).toBeInTheDocument();
    expect(screen.getByText('deploy now?')).toBeInTheDocument();
  });

  it('shows the calm tick and no inbox when there is nothing open', () => {
    const escalations = [esc({ id: 'e1', project: 'P', status: 'resolved' })];
    render(<NeedsYouZone escalations={escalations} project="P" serverScope="local" />);
    expect(screen.getByTestId('needs-you-zone').getAttribute('data-needs-you')).toBe('0');
    expect(screen.queryByTestId('bridge-escalation-inbox')).toBeNull();
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();
  });

  it('excludes escalations from other projects (selector scope)', () => {
    const escalations = [esc({ id: 'e1', project: 'OTHER', status: 'open' })];
    render(<NeedsYouZone escalations={escalations} project="P" serverScope="local" />);
    expect(screen.getByTestId('needs-you-zone').getAttribute('data-needs-you')).toBe('0');
    expect(screen.queryByTestId('bridge-escalation-inbox')).toBeNull();
  });
});
