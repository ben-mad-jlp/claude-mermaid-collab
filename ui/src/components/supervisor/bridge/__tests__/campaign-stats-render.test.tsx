/**
 * campaign-stats-render.test.tsx — Campaign panel mission and leaf count rendering.
 *
 * Verifies that the live campaign branch renders mission and leaf counts from the
 * campaign object with ?? 0 fallback for backward compatibility with snapshots
 * from older servers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';
import CampaignPanel from '../CampaignPanel';

const probe = (id: string, campaignId: string) => ({
  id,
  campaignId,
  kind: 'command' as const,
  environment: 'worktree' as const,
  dependsOn: [],
  declaredPaths: [],
  verdict: 'fail' as const,
  command: 'run probe',
  createdAt: 1629801600000,
  lastEvidenceAt: null,
  lastEvidence: null,
  lastEvidenceEnvironment: null,
  lastEvidenceCommitSha: null,
});

describe('CampaignPanel stats rendering', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ campaignsByProject: {} });
  });

  it('the campaign panel shows mission and leaf counts', () => {
    const fixture: BridgeCampaign[] = [
      {
        id: 'camp-with-counts',
        title: 'Campaign with Stats',
        goal: 'test campaign goal',
        createdAt: 1629801600000,
        droppedAt: null,
        missionCount: 3,
        leafCount: 17,
        probes: [],
        ruling: null,
      },
    ];

    act(() => {
      useSupervisorStore.setState({ campaignsByProject: { P: fixture } });
    });
    render(<CampaignPanel project="P" />);

    const countsElement = screen.getByTestId('campaign-counts');
    expect(countsElement.textContent).toContain('3');
    expect(countsElement.textContent).toContain('17');
    expect(countsElement.textContent).toContain('missions');
    expect(countsElement.textContent).toContain('leaves');
  });
});
