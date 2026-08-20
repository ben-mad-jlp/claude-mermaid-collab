/**
 * CampaignPanel chamber index — the campaign-chamber wrapper renders one
 * chamber-decision-row per entry of chamberHistory, falling back to a single
 * row derived from `chamber` when chamberHistory is absent.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign, BridgeChamberDeliberation } from '@/types/campaign';
import CampaignPanel from '../CampaignPanel';

function makeDeliberation(sessionId: string, decidedAt: number): BridgeChamberDeliberation {
  return {
    sessionId,
    outcome: 'decision',
    chosenCandidate: `candidate for ${sessionId}`,
    strongestDissent: null,
    refiningGuidance: null,
    decidedAtSha: `sha-${sessionId}`,
    decidedAt,
    proposals: [],
    vetoes: [],
    wargame: [],
    decision: [],
  };
}

describe('CampaignPanel chamber index', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ campaignsByProject: {} });
  });

  it('renders one chamber-decision-row per chamberHistory decision inside campaign-chamber', () => {
    const fixture: BridgeCampaign[] = [
      {
        id: 'camp-history',
        title: 'Campaign with History',
        goal: 'Test history rendering',
        createdAt: 1629801600000,
        probes: [],
        ruling: null,
        chamberHistory: [
          makeDeliberation('session-a', 1629802500000),
          makeDeliberation('session-b', 1629803500000),
          makeDeliberation('session-c', 1629804500000),
        ],
      },
    ];

    act(() => {
      useSupervisorStore.setState({ campaignsByProject: { P: fixture } });
    });

    render(<CampaignPanel project="P" />);

    const wrapper = screen.getByTestId('campaign-chamber');
    expect(within(wrapper).getAllByTestId('chamber-decision-row')).toHaveLength(3);
  });

  it('renders exactly one chamber-decision-row when chamberHistory is undefined and chamber is set', () => {
    const fixture: BridgeCampaign[] = [
      {
        id: 'camp-single',
        title: 'Campaign with Single Chamber',
        goal: 'Test single-chamber fallback',
        createdAt: 1629801600000,
        probes: [],
        ruling: null,
        chamber: makeDeliberation('session-only', 1629802500000),
      },
    ];

    act(() => {
      useSupervisorStore.setState({ campaignsByProject: { P: fixture } });
    });

    render(<CampaignPanel project="P" />);

    const wrapper = screen.getByTestId('campaign-chamber');
    expect(within(wrapper).getAllByTestId('chamber-decision-row')).toHaveLength(1);
  });
});
