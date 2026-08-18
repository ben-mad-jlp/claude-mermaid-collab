/**
 * CampaignPanel chamber test — validates chamber deliberation rendering.
 * Tests veto reason rendering and decision guidance rendering.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';
import CampaignPanel from './CampaignPanel';

describe('CampaignPanel chamber deliberation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSupervisorStore.setState({
      campaignsByProject: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders a veto row with its written reason', () => {
    const vetoReason = 'This implementation does not handle the edge case where the input is null and the timeout expires simultaneously.';

    const fixtureWithChamber: BridgeCampaign[] = [
      {
        id: 'camp-chamber',
        title: 'Campaign with Chamber Deliberation',
        goal: 'Test chamber rendering',
        createdAt: 1629801600000,
        probes: [],
        ruling: null,
        chamber: {
          sessionId: 'session-001',
          outcome: 'decision',
          chosenCandidate: 'candidate-a',
          strongestDissent: null,
          refiningGuidance: 'Consider adding a safety check for concurrent timeout scenarios',
          decidedAtSha: 'abc123def456789abc',
          decidedAt: 1629802500000,
          proposals: [],
          vetoes: [
            {
              phase: 'veto',
              role: 'lens-security',
              model: 'claude-opus-5',
              content: vetoReason,
              createdAt: 1629802000000,
            },
          ],
          wargame: [],
          decision: [],
        },
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureWithChamber },
      });
    });

    vi.clearAllTimers();
    render(<CampaignPanel project="P" />);

    // Assert the chamber section is rendered
    expect(screen.getByTestId('campaign-chamber')).toBeTruthy();

    // Assert the veto row is rendered with the full reason text
    expect(screen.getByText(vetoReason)).toBeTruthy();

    // Assert the veto role is also rendered
    expect(screen.getByText('lens-security')).toBeTruthy();
  });

  it('renders the president decision with its refining guidance', () => {
    const refiningGuidance = 'Implement a robust cancellation mechanism before the final merge.';

    const fixtureWithDecision: BridgeCampaign[] = [
      {
        id: 'camp-decision',
        title: 'Campaign with President Decision',
        goal: 'Test ruling rendering',
        createdAt: 1629801600000,
        probes: [],
        ruling: null,
        chamber: {
          sessionId: 'session-002',
          outcome: 'decision',
          chosenCandidate: 'candidate-b',
          strongestDissent: 'Some lens disagreed on safety',
          refiningGuidance,
          decidedAtSha: 'def456ghi789abc123',
          decidedAt: 1629802600000,
          proposals: [],
          vetoes: [],
          wargame: [],
          decision: [],
        },
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureWithDecision },
      });
    });

    vi.clearAllTimers();
    render(<CampaignPanel project="P" />);

    // Assert the decision section is rendered
    const decisionBlock = screen.getByTestId('chamber-decision');
    expect(decisionBlock).toBeTruthy();

    // Assert the outcome value is rendered within the decision block
    expect(decisionBlock.textContent).toContain('decision');

    // Assert the refining guidance is rendered
    expect(screen.getByText(refiningGuidance)).toBeTruthy();
  });
});
