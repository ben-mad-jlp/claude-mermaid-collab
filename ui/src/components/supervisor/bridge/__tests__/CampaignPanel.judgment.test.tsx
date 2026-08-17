/**
 * CampaignPanel judgment test — validates per-lens rendering, dissent detection,
 * and examined evidence blocks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';
import CampaignPanel from '../CampaignPanel';

describe('CampaignPanel judgment rendering', () => {
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

  it('renders each lens verdict with its reasoning and shows dissent when the panel disagreed', () => {
    // Create a campaign with a split ruling (2 done, 1 not-done)
    const fixtureWithDissent: BridgeCampaign[] = [
      {
        id: 'camp-dissent',
        title: 'Campaign with Dissent',
        goal: 'Test judgment rendering',
        createdAt: 1629801600000,
        probes: [
          {
            id: 'probe-001',
            campaignId: 'camp-dissent',
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
        ruling: {
          judge: 'completeness-judge',
          verdict: 'done',
          rationale: 'Majority lens votes yes',
          ruledAtSha: 'abc123def456789abc',
          ruledAt: 1629802500000,
          artifactsRead: [],
          commandsRun: [],
          citedLenses: [],
          lenses: [
            {
              lens: 'correctness',
              verdict: 'done',
              reasoning: 'Implementation matches spec',
              round: 'independent',
              changedVerdict: false,
            },
            {
              lens: 'completeness',
              verdict: 'done',
              reasoning: 'All acceptance criteria addressed',
              round: 'independent',
              changedVerdict: false,
            },
            {
              lens: 'safety',
              verdict: 'not-done',
              reasoning: 'Needs edge case handling',
              round: 'deliberation',
              changedVerdict: true,
            },
          ],
        },
      },
    ];

    // Populate store with split verdict
    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureWithDissent },
      });
    });

    vi.clearAllTimers();
    render(<CampaignPanel project="P" />);

    // Assert all three lens names are rendered
    expect(screen.getAllByText('correctness')[0]).toBeTruthy();
    expect(screen.getByText('completeness')).toBeTruthy();
    expect(screen.getByText('safety')).toBeTruthy();

    // Assert all three reasoning strings are rendered
    expect(screen.getByText('Implementation matches spec')).toBeTruthy();
    expect(screen.getByText('All acceptance criteria addressed')).toBeTruthy();
    expect(screen.getByText('Needs edge case handling')).toBeTruthy();

    // Assert dissent is rendered
    const dissentElement = screen.queryByTestId('campaign-dissent');
    expect(dissentElement).toBeTruthy();
    expect(dissentElement?.textContent).toBe('Dissent');

    // Assert changed verdict chip is present
    expect(screen.getByText('changed')).toBeTruthy();

    // Now re-render with a unanimous ruling (all done, no changes)
    const fixtureUnanimous: BridgeCampaign[] = [
      {
        id: 'camp-unanimous',
        title: 'Campaign Unanimous',
        goal: 'Test unanimous verdict',
        createdAt: 1629801600000,
        probes: [],
        ruling: {
          judge: 'completeness-judge',
          verdict: 'done',
          rationale: 'All lenses agree',
          ruledAtSha: 'def789abc123def78',
          ruledAt: 1629802500000,
          artifactsRead: [],
          commandsRun: [],
          citedLenses: [],
          lenses: [
            {
              lens: 'correctness',
              verdict: 'done',
              reasoning: 'Implementation matches spec',
              round: 'independent',
              changedVerdict: false,
            },
            {
              lens: 'completeness',
              verdict: 'done',
              reasoning: 'All acceptance criteria addressed',
              round: 'independent',
              changedVerdict: false,
            },
            {
              lens: 'safety',
              verdict: 'done',
              reasoning: 'Edge cases handled properly',
              round: 'independent',
              changedVerdict: false,
            },
          ],
        },
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureUnanimous },
      });
    });

    // Dissent should not be rendered for unanimous verdict
    const dissentAfter = screen.queryByTestId('campaign-dissent');
    expect(dissentAfter).toBeNull();

    // Changed verdict chip should not be present
    expect(screen.queryByText('changed')).toBeNull();
  });

  it('shows what each judge examined, not only its verdict', () => {
    // Create a campaign with examined evidence
    const fixtureWithEvidence: BridgeCampaign[] = [
      {
        id: 'camp-evidence',
        title: 'Campaign with Evidence',
        goal: 'Validate examination rendering',
        createdAt: 1629801600000,
        probes: [
          {
            id: 'probe-001',
            campaignId: 'camp-evidence',
            kind: 'command',
            environment: 'worktree',
            dependsOn: [],
            declaredPaths: ['src/**'],
            verdict: 'pass',
            command: 'bun test',
            createdAt: 1629801600000,
            lastEvidenceAt: 1629802000000,
            lastEvidence: 'All tests passed',
            lastEvidenceEnvironment: 'worktree',
            lastEvidenceCommitSha: 'abc123def456',
          },
        ],
        ruling: {
          judge: 'completeness-judge',
          verdict: 'done',
          rationale: null,
          ruledAtSha: 'abc123def456789abc',
          ruledAt: 1629802500000,
          artifactsRead: [
            'src/services/campaign-snapshot.ts',
            'ui/src/components/supervisor/bridge/CampaignPanel.tsx',
          ],
          commandsRun: [
            'bun test src/services/campaign-snapshot.test.ts',
            'npm run test:ci -- ui/src/components/supervisor/bridge/__tests__/CampaignPanel.judgment.test.tsx',
          ],
          citedLenses: ['correctness-lens', 'completeness-lens'],
          lenses: [
            {
              lens: 'correctness',
              verdict: 'done',
              reasoning: 'Code changes implement spec correctly',
              round: 'independent',
              changedVerdict: false,
            },
          ],
        },
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureWithEvidence },
      });
    });

    vi.clearAllTimers();
    render(<CampaignPanel project="P" />);

    // Assert each artifact is found
    expect(
      screen.getByText('src/services/campaign-snapshot.ts')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'ui/src/components/supervisor/bridge/CampaignPanel.tsx'
      )
    ).toBeTruthy();

    // Assert each command is found
    expect(
      screen.getByText('bun test src/services/campaign-snapshot.test.ts')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'npm run test:ci -- ui/src/components/supervisor/bridge/__tests__/CampaignPanel.judgment.test.tsx'
      )
    ).toBeTruthy();

    // Assert cited lenses are found
    expect(screen.getByText('correctness-lens')).toBeTruthy();
    expect(screen.getByText('completeness-lens')).toBeTruthy();
  });
});
