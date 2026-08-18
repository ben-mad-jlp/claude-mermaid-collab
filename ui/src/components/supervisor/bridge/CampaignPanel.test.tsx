/**
 * CampaignPanel chamber test — validates chamber deliberation rendering.
 * Tests veto reason rendering and decision guidance rendering.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders the comptroller row with its agenda description from the snapshot roster', () => {
    const comptrollerAgenda = 'Examines budget consumption and cost tracking through the lens of restraint';
    const proposalContent = 'We should adopt a conservative approach to budget allocation.';

    const fixtureWithRoster: BridgeCampaign[] = [
      {
        id: 'camp-roster',
        title: 'Campaign with Chamber Roster',
        goal: 'Test roster agenda rendering',
        createdAt: 1629801600000,
        probes: [],
        ruling: null,
        chamber: {
          sessionId: 'session-003',
          outcome: 'decision',
          chosenCandidate: 'candidate-a',
          strongestDissent: null,
          refiningGuidance: null,
          decidedAtSha: 'xyz789abc123xyz',
          decidedAt: 1629802600000,
          proposals: [
            {
              phase: 'propose',
              role: 'comptroller',
              model: 'claude-opus-5',
              content: proposalContent,
              createdAt: 1629802000000,
            },
          ],
          vetoes: [],
          wargame: [],
          decision: [],
        },
        chamberRoster: [
          {
            name: 'comptroller',
            agenda: comptrollerAgenda,
          },
        ],
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureWithRoster },
      });
    });

    vi.clearAllTimers();
    render(<CampaignPanel project="P" />);

    // Assert the comptroller role is rendered
    expect(screen.getByText('comptroller')).toBeTruthy();

    // Assert the comptroller agenda is rendered in the proposal row
    const proposalRow = screen.getByTestId('chamber-proposal');
    expect(proposalRow.textContent).toContain(comptrollerAgenda);

    // Assert the agenda element has the correct test id
    const agendaElement = screen.getByTestId('chamber-role-agenda');
    expect(agendaElement.textContent).toContain(comptrollerAgenda);
  });

  it('renders the deliberation transcript inside a scrollable container', () => {
    const fixtureWithChamber: BridgeCampaign[] = [
      {
        id: 'camp-scroll',
        title: 'Campaign with Scrollable Transcript',
        goal: 'Test scrollable container',
        createdAt: 1629801600000,
        probes: [],
        ruling: null,
        chamber: {
          sessionId: 'session-004',
          outcome: 'decision',
          chosenCandidate: null,
          strongestDissent: null,
          refiningGuidance: null,
          decidedAtSha: 'abc123def456',
          decidedAt: 1629802500000,
          proposals: [],
          vetoes: [],
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

    const transcript = screen.getByTestId('chamber-transcript');
    expect(transcript).toBeTruthy();
    expect(transcript.className).toMatch(/max-h-/);
    expect(transcript.className).toContain('overflow-y-auto');
  });

  it('groups transcript rows under their phase heading in convene order', () => {
    const proposalContent = 'Proposal content here';
    const vetoContent = 'Veto content here';
    const wargameContent = 'Wargame content here';

    const fixtureWithAllPhases: BridgeCampaign[] = [
      {
        id: 'camp-phases',
        title: 'Campaign with All Phases',
        goal: 'Test phase heading order',
        createdAt: 1629801600000,
        probes: [],
        ruling: null,
        chamber: {
          sessionId: 'session-005',
          outcome: 'decision',
          chosenCandidate: 'candidate-x',
          strongestDissent: null,
          refiningGuidance: null,
          decidedAtSha: 'xyz789abc123',
          decidedAt: 1629802500000,
          proposals: [
            {
              phase: 'propose',
              role: 'lens-architect',
              model: 'claude-opus-5',
              content: proposalContent,
              createdAt: 1629802000000,
            },
          ],
          vetoes: [
            {
              phase: 'veto',
              role: 'lens-security',
              model: 'claude-opus-5',
              content: vetoContent,
              createdAt: 1629802100000,
            },
          ],
          wargame: [
            {
              phase: 'wargame',
              role: 'lens-performance',
              model: 'claude-opus-5',
              content: wargameContent,
              createdAt: 1629802200000,
            },
          ],
          decision: [],
        },
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureWithAllPhases },
      });
    });

    vi.clearAllTimers();
    render(<CampaignPanel project="P" />);

    // Get all phase headings in document order
    const headings = screen.getAllByTestId('chamber-phase-heading');
    expect(headings.length).toBe(4);
    expect(headings.map((h) => h.textContent?.trim())).toEqual([
      'Propose',
      'Veto',
      'Wargame',
      'Decision',
    ]);

    // Assert per-heading containment
    // Heading[0] (Propose) parent contains chamber-proposal row
    const proposalRow = screen.getByTestId('chamber-proposal');
    expect(headings[0].parentElement).toBe(proposalRow.parentElement);

    // Heading[1] (Veto) parent contains chamber-veto row
    const vetoRow = screen.getByTestId('chamber-veto');
    expect(headings[1].parentElement).toBe(vetoRow.parentElement);

    // Heading[2] (Wargame) parent contains chamber-wargame row
    const wargameRow = screen.getByTestId('chamber-wargame');
    expect(headings[2].parentElement).toBe(wargameRow.parentElement);

    // Heading[3] (Decision) parentElement is the chamber-decision element itself
    const decisionBlock = screen.getByTestId('chamber-decision');
    expect(headings[3].parentElement).toBe(decisionBlock);
  });

  it('clamps a long proposal body and expands it on click', () => {
    // Create a long string by repeating without trailing spaces to avoid whitespace issues
    const baseSentence = 'We should adopt a comprehensive error handling strategy that covers all edge cases and improves robustness.';
    const longBody = baseSentence + ' ' + baseSentence + ' ' + baseSentence;

    const fixtureWithLongBody: BridgeCampaign[] = [
      {
        id: 'camp-clamp',
        title: 'Campaign with Clamped Proposal',
        goal: 'Test clamp/expand behavior',
        createdAt: 1629801600000,
        probes: [],
        ruling: null,
        chamber: {
          sessionId: 'session-006',
          outcome: 'decision',
          chosenCandidate: null,
          strongestDissent: null,
          refiningGuidance: null,
          decidedAtSha: 'clamp123abc',
          decidedAt: 1629802500000,
          proposals: [
            {
              phase: 'propose',
              role: 'lens-architect',
              model: 'claude-opus-5',
              content: longBody,
              createdAt: 1629802000000,
            },
          ],
          vetoes: [],
          wargame: [],
          decision: [],
        },
      },
    ];

    act(() => {
      useSupervisorStore.setState({
        campaignsByProject: { P: fixtureWithLongBody },
      });
    });

    vi.clearAllTimers();
    render(<CampaignPanel project="P" />);

    // Initially, the full body should not be in the DOM
    expect(screen.queryByText(longBody)).toBeNull();

    // The chamber-body element should have data-clamped="true"
    const chamberBody = screen.getByTestId('chamber-body');
    expect(chamberBody.getAttribute('data-clamped')).toBe('true');

    // Click the Show more button
    const button = screen.getByRole('button', { name: 'Show more' });
    act(() => {
      fireEvent.click(button);
    });

    // After expanding, the full body should be visible
    expect(screen.getByText(longBody)).toBeTruthy();

    // The chamber-body element should have data-clamped="false"
    expect(chamberBody.getAttribute('data-clamped')).toBe('false');
  });
});
