/**
 * Steward provenance (Steward P3) — the "steward sent this to you" tag and the
 * routedTo selectors. Proves a triaged-and-deferred escalation (routedTo ===
 * 'steward') is visually distinguished from a never-seen one in the NeedsYouZone
 * cards, and that the pure selectors classify membership correctly.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NeedsYouZone } from './NeedsYouZone';
import { isStewardRouted, selectStewardDeferred } from './escalationSelectors';
import type { Escalation } from '@/stores/supervisorStore';

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

describe('steward provenance tag', () => {
  it('shows the "steward sent this" tag for a steward-routed escalation', () => {
    render(<NeedsYouZone escalations={[esc({ routedTo: 'steward' })]} project="P" serverScope="local" />);
    expect(screen.getByTestId('steward-provenance-tag')).toBeTruthy();
  });

  it('omits the tag for a human-routed escalation', () => {
    render(<NeedsYouZone escalations={[esc({ routedTo: 'human' })]} project="P" serverScope="local" />);
    expect(screen.queryByTestId('steward-provenance-tag')).toBeNull();
  });
});
