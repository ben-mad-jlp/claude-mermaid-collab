/**
 * CampaignStrip rendering tests — live campaign lines with probe counts,
 * chamber outcomes, and linked mission nicknames.
 *
 * Tests the strip's display logic: live campaigns show, dropped ones hide,
 * and clicking invokes the stage takeover.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';
import CampaignStrip from './CampaignStrip';

const probe = (verdict: string) => ({
  id: `probe-${Math.random()}`,
  campaignId: 'camp-test',
  kind: 'command' as const,
  environment: 'worktree' as const,
  dependsOn: [],
  declaredPaths: [],
  verdict,
  command: 'test',
  createdAt: 1629801600000,
  lastEvidenceAt: null,
  lastEvidence: null,
  lastEvidenceEnvironment: null,
  lastEvidenceCommitSha: null,
});

describe('CampaignStrip', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ campaignsByProject: {} });
  });

  it('renders a live campaign line with probe counts and the latest chamber outcome', () => {
    const fixture: BridgeCampaign[] = [
      {
        id: 'camp-1',
        title: 'Integration Tests',
        goal: null,
        createdAt: 1629801600000,
        droppedAt: null,
        probes: [probe('pass'), probe('fail')],
        ruling: null,
        chamber: {
          sessionId: 'sess-1',
          outcome: 'decision',
          chosenCandidate: 'candidate-a',
          strongestDissent: null,
          refiningGuidance: null,
          decidedAtSha: 'abc123',
          decidedAt: 1629900000000,
          proposals: [],
          vetoes: [],
          wargame: [],
          decision: [],
        },
        linkedMissions: [{ id: 'm1', nickname: 'brave-otter' }],
      },
    ];

    act(() => {
      useSupervisorStore.setState({ campaignsByProject: { P: fixture } });
    });
    render(<CampaignStrip project="P" onOpenCampaigns={() => {}} />);

    const line = screen.getByTestId('campaign-strip-line');
    expect(line.textContent).toContain('Integration Tests');
    expect(line.textContent).toContain('1/2');
    expect(line.textContent).toContain('decision');
    expect(line.textContent).toContain('brave-otter');
  });

  it('renders nothing when every campaign is dropped', () => {
    const fixture: BridgeCampaign[] = [
      {
        id: 'camp-dropped',
        title: 'Old Campaign',
        goal: null,
        createdAt: 1629801600000,
        droppedAt: 1629900000000,
        probes: [],
        ruling: null,
      },
    ];

    act(() => {
      useSupervisorStore.setState({ campaignsByProject: { P: fixture } });
    });
    render(<CampaignStrip project="P" onOpenCampaigns={() => {}} />);

    expect(screen.queryByTestId('campaign-strip')).toBeNull();
  });

  it('clicking the line swaps the stage to the campaign panel', async () => {
    const onOpenCampaigns = vi.fn();
    const fixture: BridgeCampaign[] = [
      {
        id: 'camp-1',
        title: 'Test Campaign',
        goal: null,
        createdAt: 1629801600000,
        droppedAt: null,
        probes: [probe('pass')],
        ruling: null,
      },
    ];

    act(() => {
      useSupervisorStore.setState({ campaignsByProject: { P: fixture } });
    });
    render(<CampaignStrip project="P" onOpenCampaigns={onOpenCampaigns} />);

    await userEvent.click(screen.getByTestId('campaign-strip-line'));
    expect(onOpenCampaigns).toHaveBeenCalledOnce();
  });
});
