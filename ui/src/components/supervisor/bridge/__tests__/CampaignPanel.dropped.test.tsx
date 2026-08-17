/**
 * CampaignPanel dropped-campaign rendering — a retired campaign must not look live.
 *
 * A dropped campaign (droppedAt set) collapses to one muted line with a "dropped"
 * badge: no goal, no probe rows, no ruling block. A live campaign in the same list
 * keeps its full rendering. Snapshots from an older server omit the field entirely —
 * missing means live.
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

describe('CampaignPanel dropped campaigns', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ campaignsByProject: {} });
  });

  it('collapses a dropped campaign to a badge line and keeps the live one full', () => {
    const fixture: BridgeCampaign[] = [
      {
        id: 'camp-dropped',
        title: 'Old Retired Campaign',
        goal: 'should not render',
        createdAt: 1629801600000,
        droppedAt: 1629900000000,
        probes: [probe('probe-d1', 'camp-dropped')],
        ruling: null,
      },
      {
        id: 'camp-live',
        title: 'Live Campaign',
        goal: 'still driving work',
        createdAt: 1629801600000,
        droppedAt: null,
        probes: [probe('probe-l1', 'camp-live')],
        ruling: null,
      },
    ];

    act(() => {
      useSupervisorStore.setState({ campaignsByProject: { P: fixture } });
    });
    render(<CampaignPanel project="P" />);

    // Dropped: one line with badge, no goal, no probes, no unruled block for it.
    const droppedRow = screen.getByTestId('campaign-dropped');
    expect(droppedRow.textContent).toContain('Old Retired Campaign');
    expect(droppedRow.textContent).toContain('dropped');
    expect(screen.queryByText('should not render')).toBeNull();
    expect(screen.queryByText(/probe-d1/)).toBeNull();

    // Live campaign untouched: goal, probe row, unruled state all present.
    expect(screen.getByText('Live Campaign')).toBeTruthy();
    expect(screen.getByText('still driving work')).toBeTruthy();
    expect(screen.getByText(/probe-l1/)).toBeTruthy();
    expect(screen.getAllByTestId('campaign-unruled')).toHaveLength(1);
  });

  it('treats a missing droppedAt field (older server snapshot) as live', () => {
    const fixture: BridgeCampaign[] = [
      {
        id: 'camp-legacy',
        title: 'Legacy Snapshot Campaign',
        goal: 'from a server without the field',
        createdAt: 1629801600000,
        probes: [],
        ruling: null,
      },
    ];

    act(() => {
      useSupervisorStore.setState({ campaignsByProject: { P: fixture } });
    });
    render(<CampaignPanel project="P" />);

    expect(screen.queryByTestId('campaign-dropped')).toBeNull();
    expect(screen.getByText('Legacy Snapshot Campaign')).toBeTruthy();
    expect(screen.getByText('from a server without the field')).toBeTruthy();
  });
});
