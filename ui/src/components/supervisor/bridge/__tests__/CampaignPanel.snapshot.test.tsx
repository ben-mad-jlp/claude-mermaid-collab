/**
 * CampaignPanel snapshot test — validates that the panel renders campaign state
 * from the bridge snapshot without issuing its own fetch or scheduling timers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';
import CampaignPanel from '../CampaignPanel';

describe('CampaignPanel', () => {
  // Reuse the campaign fixture from campaignStoreSnapshot.test.ts
  const fixture: BridgeCampaign[] = [
    {
      id: 'camp-001',
      title: 'Test Campaign',
      goal: 'Test goal',
      createdAt: 1629801600000,
      probes: [
        {
          id: 'probe-001',
          campaignId: 'camp-001',
          kind: 'command',
          environment: 'worktree',
          dependsOn: [],
          declaredPaths: ['src/**'],
          verdict: 'pass',
          command: 'npm test',
          createdAt: 1629801600000,
          lastEvidenceAt: 1629802000000,
          lastEvidence: 'All tests passed',
          lastEvidenceEnvironment: 'worktree',
          lastEvidenceCommitSha: 'abc123def456',
        },
      ],
      ruling: null,
    },
  ];

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

  it('renders campaign state from the existing bridge snapshot without issuing its own fetch', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // Populate the store with the fixture
    useSupervisorStore.setState({
      campaignsByProject: { P: fixture },
    });

    // Clear any timers that were set during store init
    vi.clearAllTimers();

    // Render the component
    render(<CampaignPanel project="P" />);

    // Assert the campaign title and probe are in the document
    expect(screen.getByText('Test Campaign')).toBeTruthy();
    expect(screen.getByText('probe-00')).toBeTruthy();
    expect(screen.getByText('command')).toBeTruthy();

    // Assert no fetch was called and no timers are scheduled
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(vi.getTimerCount()).toBe(0);

    // Advance time and re-assert no timers were scheduled
    vi.advanceTimersByTime(60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
