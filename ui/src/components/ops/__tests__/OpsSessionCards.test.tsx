import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * OpsSessionCards escalation wiring: verify a session-scoped escalation on an
 * auto-carded external session (subscribed but no heartbeat) renders answerable
 * options and resolves optimistically on click. Tests the end-to-end path:
 * subscription match (project + session) → escalation render → decision callback.
 */

vi.mock('@/components/layout/SessionCard', () => ({
  ClaudePixAvatar: () => <div data-testid="pix" />,
  useElapsed: () => null,
  activateSessionCard: vi.fn(async () => undefined),
}));
vi.mock('@/components/supervisor/zen/ZenPulseLine', () => ({
  ZenPulseLine: () => <div data-testid="pulse" />,
}));
vi.mock('@/components/supervisor/zen/ZenNextPanel', () => ({
  ZenNextPanel: () => <div data-testid="next" />,
}));

import { OpsSessionCards } from '../OpsSessionCards';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';

const NOW = Date.now();
const project = '/repo';
const session = 'ext1';
const serverId = 'local';

describe('OpsSessionCards escalation wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSupervisorStore.setState({
      openEscalations: [],
      resolvedEscalations: [],
      escalations: [],
      supervised: [],
      todosByProject: {},
      sessionSummaries: {},
    });
    useSubscriptionStore.setState({ subscriptions: {}, order: [] });
    useSessionStore.setState({ sessions: [] });
  });

  it('escalation options render as answerable buttons for auto-carded external session', async () => {
    const key = `${serverId}:${project}:${session}`;
    const decideEscalation = vi.fn(async () => true);

    useSupervisorStore.setState({
      openEscalations: [
        {
          id: 'e1',
          project,
          session,
          serverId,
          kind: 'decision',
          questionText: 'Pick one:',
          status: 'open',
          createdAt: NOW,
          options: [
            { id: 'a', label: 'Option A' },
            { id: 'b', label: 'Option B' },
          ],
        },
      ],
      sessionSummaries: {},
      decideEscalation,
    });

    useSubscriptionStore.setState({
      subscriptions: {
        [key]: {
          serverId,
          project,
          session,
          status: 'unknown',
          lastUpdate: NOW,
        },
      },
      order: [key],
    });

    render(<OpsSessionCards serverScope={serverId} />);

    // Escalation options should be rendered as clickable buttons
    const optionAButton = screen.getByText('Option A');
    const optionBButton = screen.getByText('Option B');
    expect(optionAButton).toBeTruthy();
    expect(optionBButton).toBeTruthy();
  });

  it('clicking an option invokes the escalation decision handler', async () => {
    const key = `${serverId}:${project}:${session}`;
    const decideEscalation = vi.fn(async () => true);

    useSupervisorStore.setState({
      openEscalations: [
        {
          id: 'e1',
          project,
          session,
          serverId,
          kind: 'decision',
          questionText: 'Pick one:',
          status: 'open',
          createdAt: NOW,
          options: [
            { id: 'a', label: 'Option A' },
            { id: 'b', label: 'Option B' },
          ],
        },
      ],
      sessionSummaries: {},
      decideEscalation,
    });

    useSubscriptionStore.setState({
      subscriptions: {
        [key]: {
          serverId,
          project,
          session,
          status: 'unknown',
          lastUpdate: NOW,
        },
      },
      order: [key],
    });

    render(<OpsSessionCards serverScope={serverId} />);

    // Verify escalation options are rendered and clickable
    expect(screen.getByText('Option A')).toBeTruthy();
    expect(screen.getByText('Option B')).toBeTruthy();

    const optionAButton = screen.getByText('Option A');
    fireEvent.click(optionAButton);

    // Verify the decision handler was called with correct arguments
    await waitFor(() => {
      expect(decideEscalation).toHaveBeenCalledWith(serverId, 'e1', 'a');
    });

    // Verify optimistic resolution: "Sent" confirmation appears without waiting for store update
    await waitFor(() => {
      expect(screen.getByText(/Sent/)).toBeTruthy();
    });
  });
});
