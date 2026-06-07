import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StewardPanel } from './StewardPanel';
import { useSupervisorStore, type StewardLiveness } from '@/stores/supervisorStore';

// The panel polls on mount; stub the loaders so no real fetch fires and seed the
// store state directly to drive the three front-door states.
function seed(stewardLiveness: StewardLiveness | null) {
  useSupervisorStore.setState({
    stewardLiveness,
    escalations: [],
    loadStewardIdentity: async () => {},
    loadEscalations: async () => {},
  } as any);
}

describe('StewardPanel — three states', () => {
  beforeEach(() => seed(null));

  it("renders the 'none' front door when no steward has ever registered", () => {
    seed({ identity: null, running: false, stale: true, ageMs: null, overrideAccepts: 0 });
    render(<StewardPanel currentProject="/p" />);
    expect(screen.getByTestId('steward-panel').getAttribute('data-state')).toBe('none');
    expect(screen.getByRole('heading', { name: 'Launch the Steward' })).toBeTruthy();
    expect(screen.getByTestId('steward-launch').textContent).toContain('Launch the Steward');
  });

  it('launches in one click — no session-name input, button enabled with a project scope', () => {
    seed({ identity: null, running: false, stale: true, ageMs: null, overrideAccepts: 0 });
    const { container } = render(<StewardPanel currentProject="/p" />);
    // The session-name text box is gone — the steward is always named 'steward'.
    expect(container.querySelector('input[type="text"]')).toBeNull();
    // The launch button is immediately clickable (no typing required).
    const launch = screen.getByTestId('steward-launch') as HTMLButtonElement;
    expect(launch.disabled).toBe(false);
  });

  it("renders the 'crashed' front door when the steward heartbeat is stale", () => {
    seed({ identity: { project: '/p', session: 'steward', updatedAt: 1 }, running: false, stale: true, ageMs: 999999, overrideAccepts: 0 });
    render(<StewardPanel currentProject="/p" />);
    expect(screen.getByTestId('steward-panel').getAttribute('data-state')).toBe('crashed');
    expect(screen.getByText('Steward — not running')).toBeTruthy();
  });

  it("renders the running dashboard with the override-accept count visible (the scary metric)", () => {
    seed({ identity: { project: '/p', session: 'steward', updatedAt: Date.now() }, running: true, stale: false, ageMs: 100, overrideAccepts: 3 });
    render(<StewardPanel currentProject="/p" />);
    expect(screen.getByTestId('steward-panel').getAttribute('data-state')).toBe('running');
    const card = screen.getByTestId('steward-override-count');
    expect(card.textContent).toContain('3');
    expect(card.textContent).toMatch(/override-accepts this session/i);
    // [Pause] / [Take over] controls are surfaced.
    expect(screen.getByTestId('steward-pause')).toBeTruthy();
    expect(screen.getByTestId('steward-takeover')).toBeTruthy();
  });

  it('renders a clickable SessionCard for the steward session when running', () => {
    seed({ identity: { project: '/p', session: 'steward', updatedAt: Date.now() }, running: true, stale: false, ageMs: 100, overrideAccepts: 0 });
    render(<StewardPanel currentProject="/p" />);
    const card = screen.getByTestId('steward-session-card');
    expect(card).toBeTruthy();
    // The card shows the steward session name.
    expect(card.textContent).toContain('steward');
  });
});

describe('StewardPanel — ON/OFF switch', () => {
  beforeEach(() => seed(null));

  it('shows ON when switchedOn is true and OFF when false', () => {
    seed({ identity: { project: '/p', session: 'steward', updatedAt: Date.now() }, running: true, stale: false, ageMs: 100, overrideAccepts: 0, switchedOn: true });
    const { rerender } = render(<StewardPanel currentProject="/p" />);
    const onToggle = screen.getByTestId('steward-enabled-toggle');
    expect(onToggle.getAttribute('data-enabled')).toBe('true');
    expect(onToggle.textContent).toContain('ON');

    seed({ identity: { project: '/p', session: 'steward', updatedAt: Date.now() }, running: true, stale: false, ageMs: 100, overrideAccepts: 0, switchedOn: false });
    rerender(<StewardPanel currentProject="/p" />);
    const offToggle = screen.getByTestId('steward-enabled-toggle');
    expect(offToggle.getAttribute('data-enabled')).toBe('false');
    expect(offToggle.textContent).toContain('OFF');
  });

  it('labels the toggle as the escalation auto-answer switch (not a whole-steward switch)', () => {
    seed({ identity: { project: '/p', session: 'steward', updatedAt: Date.now() }, running: true, stale: false, ageMs: 100, overrideAccepts: 0, switchedOn: true });
    render(<StewardPanel currentProject="/p" />);
    // The visible label makes clear the toggle gates only escalation auto-answer —
    // dogfooding runs regardless (feedback_steward_dogfood_always_on).
    expect(screen.getByText('Auto-answer escalations')).toBeTruthy();
  });
});
