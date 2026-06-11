/**
 * Steward provenance (Steward P3) — the "steward sent this to you" tag and the
 * routedTo selectors. Proves a triaged-and-deferred escalation (routedTo ===
 * 'steward') is visually distinguished from a never-seen one in the NeedsYouZone
 * cards, and that the pure selectors classify membership correctly.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NeedsYouZone } from './NeedsYouZone';
import { isStewardRouted, selectStewardDeferred } from './escalationSelectors';
import { useSupervisorStore, type Escalation } from '@/stores/supervisorStore';

function esc(p: Partial<Escalation>): Escalation {
  return {
    id: p.id ?? 'e1',
    project: 'P',
    session: 'worker-1',
    kind: 'blocker',
    questionText: 'blocked on X',
    status: 'open',
    createdAt: 1,
    ...p,
  } as Escalation;
}

describe('steward provenance selectors', () => {
  it('isStewardRouted is true only when routedTo === "steward"', () => {
    expect(isStewardRouted(esc({ routedTo: 'steward' }))).toBe(true);
    expect(isStewardRouted(esc({ routedTo: 'human' }))).toBe(false);
    expect(isStewardRouted(esc({}))).toBe(false); // absent → human
  });

  it('selectStewardDeferred returns only the steward-routed open items', () => {
    const open = [esc({ id: 'a', routedTo: 'steward' }), esc({ id: 'b', routedTo: 'human' }), esc({ id: 'c' })];
    expect(selectStewardDeferred(open).map((e) => e.id)).toEqual(['a']);
  });
});

describe('triage lifecycle badge (supersedes the bare steward-provenance tag, fd934fb7)', () => {
  it('flags a steward-routed (Grok-deferred) escalation as "needs you — AI couldn’t resolve"', () => {
    render(<NeedsYouZone escalations={[esc({ routedTo: 'steward' })]} project="P" serverScope="local" />);
    const badge = screen.getByTestId('triage-lifecycle-badge');
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('data-state')).toBe('escalated-to-human');
  });

  it('omits the badge for a plain human-routed, untriaged escalation', () => {
    render(<NeedsYouZone escalations={[esc({ routedTo: 'human' })]} project="P" serverScope="local" />);
    expect(screen.queryByTestId('triage-lifecycle-badge')).toBeNull();
  });

  it('shows the in-flight spinner badge while a Grok consult is running', () => {
    render(<NeedsYouZone escalations={[esc({ triageInFlight: true })]} project="P" serverScope="local" />);
    const badge = screen.getByTestId('triage-lifecycle-badge');
    expect(badge.getAttribute('data-state')).toBe('ai-handling');
  });
});

describe('lingering AI-resolved card (does not silently vanish, fd934fb7)', () => {
  afterEach(() => useSupervisorStore.setState({ resolvedEscalations: [] }));

  it('renders a recently AI-resolved escalation with its outcome even when nothing is open', () => {
    useSupervisorStore.setState({
      resolvedEscalations: [
        esc({
          id: 'r1',
          project: 'P',
          status: 'resolved',
          resolvedBy: 'ai',
          resolvedAt: Date.now() - 5_000,
          suggestedAction: {
            bucket: 'now-buildable',
            verb: 'reset_todo',
            confidence: 0.9,
            rationale: 'deps complete — reset to ready',
          },
        }),
      ],
    });
    // No open escalations → the zone would normally say "All clear"; the lingering
    // card must still surface the AI outcome.
    render(<NeedsYouZone escalations={[]} project="P" serverScope="local" />);
    expect(screen.getByTestId('ai-resolved-card')).toBeTruthy();
    expect(screen.getByText(/deps complete — reset to ready/)).toBeTruthy();
  });

  it('does not linger an AI-resolved escalation from a different project', () => {
    useSupervisorStore.setState({
      resolvedEscalations: [
        esc({ id: 'r2', project: 'OTHER', status: 'resolved', resolvedBy: 'ai', resolvedAt: Date.now() - 5_000 }),
      ],
    });
    render(<NeedsYouZone escalations={[]} project="P" serverScope="local" />);
    expect(screen.queryByTestId('ai-resolved-card')).toBeNull();
  });
});
