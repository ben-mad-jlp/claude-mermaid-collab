/**
 * Red is the operator's, purple is the conductor's.
 *
 * The badge said "2 needs you" for cards the operator could not action — the audience
 * rule counted every gated kind as human, and machine cards were reduced to a grey
 * "N machine items handled" line so you could see THAT they existed but never WHICH
 * (2026-08-21). Operator policy: red = spend + explicit decisions, purple = everything else.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: unknown) => unknown) => sel({ resolvedEscalations: [] }),
}));
vi.mock('../BridgeEscalationInbox', () => ({
  BridgeEscalationInbox: ({ escalations }: { escalations: Array<{ id: string }> }) => (
    <div data-testid="inbox">{escalations.map((e) => e.id).join(',')}</div>
  ),
  default: ({ escalations }: { escalations: Array<{ id: string }> }) => (
    <div data-testid="inbox">{escalations.map((e) => e.id).join(',')}</div>
  ),
}));

import { NeedsYouZone } from '../NeedsYouZone';

const P = '/p';
const mk = (id: string, audience: 'human' | 'internal') => ({
  id, project: P, session: 's', kind: 'decision', questionText: id, status: 'open', audience,
}) as never;

describe('NeedsYouZone audience split', () => {
  it('counts only human-audience cards as needing you', () => {
    render(<NeedsYouZone escalations={[mk('h1','human'), mk('m1','internal'), mk('m2','internal')]} project={P} serverScope="" />);
    expect(screen.getByTestId('needs-you-zone').getAttribute('data-needs-you')).toBe('1');
  });

  it('renders the machine cards in their own purple group', () => {
    render(<NeedsYouZone escalations={[mk('h1','human'), mk('m1','internal')]} project={P} serverScope="" />);
    const group = screen.getByTestId('machine-handled-group');
    expect(group.className).toContain('purple');
  });

  it('shows WHICH machine cards exist, not just a count', () => {
    render(<NeedsYouZone escalations={[mk('h1','human'), mk('m1','internal'), mk('m2','internal')]} project={P} serverScope="" />);
    expect(screen.getByTestId('machine-handled-group').textContent).toContain('m1');
    expect(screen.getByTestId('machine-handled-group').textContent).toContain('m2');
  });

  it('says plainly that the machine group is not the operator to action', () => {
    render(<NeedsYouZone escalations={[mk('m1','internal')]} project={P} serverScope="" />);
    expect(screen.getByTestId('machine-items-handled').textContent).toContain('not yours to action');
  });

  it('renders no machine group when every card is the operator\'s', () => {
    render(<NeedsYouZone escalations={[mk('h1','human')]} project={P} serverScope="" />);
    expect(screen.queryByTestId('machine-handled-group')).toBeNull();
  });
});
