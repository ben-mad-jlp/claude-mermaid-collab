/**
 * Orch P2 — inline Grok suggestion on the escalation card.
 *
 * Proves an escalation carrying a `suggestedAction` renders the amber inline block
 * with the bucket, rationale, and the right action affordance: a Confirm <verb>
 * button when the verb is actionable, or a classify-only note when verb is null.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NeedsYouZone } from './NeedsYouZone';
import type { Escalation, SuggestedAction } from '@/stores/supervisorStore';

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

function sugg(p: Partial<SuggestedAction> = {}): SuggestedAction {
  return {
    bucket: 'now-buildable',
    verb: 'reset_todo',
    confidence: 0.92,
    rationale: 'all deps accepted in the store',
    ...p,
  };
}

describe('inline Grok suggestion', () => {
  it('renders the amber block with bucket + rationale for an actionable suggestion', () => {
    render(<NeedsYouZone escalations={[esc({ suggestedAction: sugg() })]} project="P" serverScope="local" />);
    const block = screen.getByTestId('escalation-suggestion');
    expect(block.getAttribute('data-bucket')).toBe('now-buildable');
    expect(screen.getByText('all deps accepted in the store')).toBeTruthy();
    // Actionable verb → Confirm button present.
    expect(screen.getByTestId('suggestion-confirm').textContent).toContain('reset_todo');
    expect(screen.getByTestId('suggestion-dismiss')).toBeTruthy();
  });

  it('shows a classify-only note (no Confirm) when the verb is null', () => {
    render(
      <NeedsYouZone
        escalations={[esc({ suggestedAction: sugg({ bucket: 'genuine-decision', verb: null }) })]}
        project="P"
        serverScope="local"
      />,
    );
    expect(screen.getByTestId('escalation-suggestion').getAttribute('data-bucket')).toBe('genuine-decision');
    expect(screen.queryByTestId('suggestion-confirm')).toBeNull();
    expect(screen.getByText(/classify-only/)).toBeTruthy();
    // Dismiss is still available.
    expect(screen.getByTestId('suggestion-dismiss')).toBeTruthy();
  });

  it('renders no suggestion block when the escalation has none', () => {
    render(<NeedsYouZone escalations={[esc({})]} project="P" serverScope="local" />);
    expect(screen.queryByTestId('escalation-suggestion')).toBeNull();
  });
});
