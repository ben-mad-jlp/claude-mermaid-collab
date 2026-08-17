/**
 * CampaignPanel states test — validates unruled state rendering and probe evidence age.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { BridgeCampaign } from '@/types/campaign';
import CampaignPanel, { PROBE_EVIDENCE_STALE_MS, formatProbeAge } from '../CampaignPanel';

describe('CampaignPanel states', () => {
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

  it('renders unruled as its own state, distinct from done', () => {
    // Fixture A: campaign with all-pass probes but no ruling
    const fixtureUnruled: BridgeCampaign[] = [
      {
        id: 'camp-unruled',
        title: 'Campaign Unruled',
        goal: 'Test unruled state rendering',
        createdAt: 1629801600000,
        probes: [
          {
            id: 'probe-001',
            campaignId: 'camp-unruled',
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
          {
            id: 'probe-002',
            campaignId: 'camp-unruled',
            kind: 'command',
            environment: 'worktree',
            dependsOn: [],
            declaredPaths: ['ui/**'],
            verdict: 'pass',
            command: 'npm run test:ci',
            createdAt: 1629801600000,
            lastEvidenceAt: 1629802100000,
            lastEvidence: 'All tests passed',
            lastEvidenceEnvironment: 'worktree',
            lastEvidenceCommitSha: 'abc123def456',
          },
        ],
        ruling: null,
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureUnruled },
      });
    });

    vi.clearAllTimers();
    render(<CampaignPanel project="P" />);

    // Fixture A: unruled state should be present
    const unruledElement = screen.queryByTestId('campaign-unruled');
    expect(unruledElement).toBeTruthy();
    expect(unruledElement?.textContent).toBe('Unruled — no judgment recorded');

    // Fixture A: ruling state should not be present
    const rulingElement = screen.queryByTestId('campaign-ruling');
    expect(rulingElement).toBeNull();

    // Now re-render with a ruling campaign (Fixture B)
    const fixtureRuled: BridgeCampaign[] = [
      {
        id: 'camp-ruled',
        title: 'Campaign Ruled',
        goal: 'Test ruled state rendering',
        createdAt: 1629801600000,
        probes: [],
        ruling: {
          judge: 'completeness-judge',
          verdict: 'done',
          rationale: 'All probes passed',
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
          ],
        },
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureRuled },
      });
    });

    // Fixture B: ruling state should be present
    const rulingElementAfter = screen.queryByTestId('campaign-ruling');
    expect(rulingElementAfter).toBeTruthy();

    // Fixture B: unruled state should not be present
    const unruledElementAfter = screen.queryByTestId('campaign-unruled');
    expect(unruledElementAfter).toBeNull();
  });

  it('shows how long ago each probe last gathered evidence', () => {
    // Use a fixed NOW timestamp
    const NOW = 1629810000000;

    // Fixture: campaign with probes at different ages
    const fixtureWithAges: BridgeCampaign[] = [
      {
        id: 'camp-ages',
        title: 'Campaign with Evidence Ages',
        goal: 'Test probe age rendering',
        createdAt: 1629801600000,
        probes: [
          {
            id: 'probe-recent',
            campaignId: 'camp-ages',
            kind: 'command',
            environment: 'worktree',
            dependsOn: [],
            declaredPaths: ['src/**'],
            verdict: 'pass',
            command: 'npm test',
            createdAt: 1629801600000,
            // 3 hours ago
            lastEvidenceAt: NOW - 3 * 60 * 60 * 1000,
            lastEvidence: 'All tests passed',
            lastEvidenceEnvironment: 'worktree',
            lastEvidenceCommitSha: 'abc123def456',
          },
          {
            id: 'probe-never',
            campaignId: 'camp-ages',
            kind: 'command',
            environment: 'worktree',
            dependsOn: [],
            declaredPaths: ['ui/**'],
            verdict: 'not-run',
            command: null,
            createdAt: 1629801600000,
            lastEvidenceAt: null,
            lastEvidence: null,
            lastEvidenceEnvironment: null,
            lastEvidenceCommitSha: null,
          },
        ],
        ruling: null,
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureWithAges },
      });
    });

    render(<CampaignPanel project="P" nowMs={NOW} />);

    // Get all probe-age spans
    const ageSpans = screen.getAllByTestId('probe-age');
    expect(ageSpans.length).toBe(2);

    // Probe 1 (3 hours ago) should show "3h ago"
    expect(ageSpans[0].textContent).toBe('3h ago');

    // Probe 2 (never ran) should show "never ran"
    expect(ageSpans[1].textContent).toContain('never ran');

    // The never-ran probe should have the data-probe-evidence attribute
    const probeRows = screen.getAllByTestId('probe-age');
    const neverRanRow = probeRows[1].parentElement;
    expect(neverRanRow?.getAttribute('data-probe-evidence')).toBe('never');
  });

  describe('formatProbeAge', () => {
    it('returns neverRan:true with label "never ran" when lastEvidenceAt is null', () => {
      const NOW = 1629810000000;
      const result = formatProbeAge(null, NOW);

      expect(result.label).toBe('never ran');
      expect(result.stale).toBe(false);
      expect(result.neverRan).toBe(true);
    });

    it('formats recent evidence as relative time without stale flag', () => {
      const NOW = 1629810000000;
      const twoHoursAgo = NOW - 2 * 60 * 60 * 1000;

      const result = formatProbeAge(twoHoursAgo, NOW);

      expect(result.label).toBe('2h ago');
      expect(result.stale).toBe(false);
      expect(result.neverRan).toBe(false);
    });

    it('marks evidence older than 24 hours as stale', () => {
      const NOW = 1629810000000;
      const twoFullDaysAgo = NOW - 2 * 24 * 60 * 60 * 1000;

      const result = formatProbeAge(twoFullDaysAgo, NOW);

      expect(result.label).toBe('2d ago');
      expect(result.stale).toBe(true);
      expect(result.neverRan).toBe(false);
    });

    it('clamps negative ages to zero', () => {
      const NOW = 1629810000000;
      const futureTimestamp = NOW + 1000;

      const result = formatProbeAge(futureTimestamp, NOW);

      expect(result.label).toBe('just now');
      expect(result.stale).toBe(false);
      expect(result.neverRan).toBe(false);
    });

    it('uses correct time bucket boundaries', () => {
      const NOW = 1629810000000;

      // Just now: < 5s
      expect(formatProbeAge(NOW - 2000, NOW).label).toBe('just now');

      // Seconds: 5-59s
      expect(formatProbeAge(NOW - 30000, NOW).label).toBe('30s ago');

      // Minutes: 1-59m
      expect(formatProbeAge(NOW - 30 * 60 * 1000, NOW).label).toBe('30m ago');

      // Hours: 1-23h
      expect(formatProbeAge(NOW - 12 * 60 * 60 * 1000, NOW).label).toBe('12h ago');

      // Days: >= 24h
      expect(formatProbeAge(NOW - 3 * 24 * 60 * 60 * 1000, NOW).label).toBe('3d ago');
    });
  });
});
