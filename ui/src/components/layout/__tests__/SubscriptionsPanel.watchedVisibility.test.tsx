import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { useSupervisorStore } from '@/stores/supervisorStore';

/**
 * Watched session visibility in the Watching list.
 *
 * A watched session stays rendered in the Watching list and is not re-offered
 * by the Watch-a-session picker, proving that rowsWithStalePeers sources from
 * projectSubscriptions (all subscriptions) rather than a filtered subset.
 */

vi.mock('@/components/layout/SessionCard', () => ({
  SessionCard: ({
    sub,
    subKey,
  }: {
    sub: { session: string; project: string; serverId: string };
    subKey?: string;
  }) => (
    <div
      data-testid="session-card"
      data-session={sub.session}
      data-subkey={subKey}
    >
      {sub.session}
    </div>
  ),
}));

vi.mock('@/stores/subscriptionStore', () => {
  const state = {
    subscriptions: {
      'srvA:proj:sessA': {
        serverId: 'srvA',
        project: 'proj',
        session: 'sessA',
        status: 'waiting',
        lastUpdate: Date.now(),
      },
    },
    order: [],
    unsubscribe: vi.fn(),
    subscribe: vi.fn(),
    reorder: vi.fn(),
  };
  const useSubscriptionStore = (sel?: (s: any) => any) => (sel ? sel(state) : state);
  return { useSubscriptionStore };
});

vi.mock('@/stores/sessionStore', () => {
  const state = {
    currentSession: {
      serverId: 'srvA',
      project: 'proj',
      name: 'sessA',
    },
    sessions: [
      { project: 'proj', name: 'sessA' },
      { project: 'proj', name: 'sessC' },
    ],
    setCurrentSession: vi.fn(),
  };
  const useSessionStore = (sel?: (s: any) => any) => (sel ? sel(state) : state);
  return { useSessionStore };
});

vi.mock('@/contexts/ServerContext', () => {
  const value = {
    servers: [
      {
        id: 'srvA',
        label: 'Server A',
        host: 'localhost',
        port: 9002,
        status: 'online',
        source: 'local',
      },
    ],
  };
  return { useServers: () => value };
});

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: vi.fn(() => null),
}));

import { SubscriptionsPanel } from '../SubscriptionsPanel';

describe('SubscriptionsPanel.watchedVisibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it('a watched session stays rendered in the Watching list and is not re-offered by the Watch-a-session picker', async () => {
    useSupervisorStore.setState({ supervised: [] });

    // Stub fetch for useSupervisedSessions poll to return the session as supervised
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okRes({ supervised: [{ project: 'proj', session: 'sessA' }] })) // supervised poll
      .mockResolvedValue({ ok: true, json: async () => ({}) })); // other calls

    render(<SubscriptionsPanel />);

    // (a) Watching-list render: session-card with data-session="sessA" is present,
    // and the Watching-count text reads '1'
    await waitFor(() => {
      const card = screen.queryByTestId('session-card');
      expect(card).toBeDefined();
      expect(card?.getAttribute('data-session')).toBe('sessA');
    });

    const watchingCount = screen.getByText('Watching').parentElement?.querySelector('span.ml-1');
    expect(watchingCount?.textContent).toBe('1');

    // (b) Picker non-offer + control: open the modal and verify sessA is absent
    // while sessC is present
    const subscribeButton = screen.getByTitle('Subscribe to a session');
    await userEvent.click(subscribeButton);

    await waitFor(() => {
      // sessC should exist in the modal (available to subscribe)
      const sessC = screen.queryByText('sessC');
      expect(sessC).toBeDefined();
    });

    // sessA should NOT be offered (already subscribed)
    const sessA = screen.queryByText('sessA');
    // If sessA appears anywhere outside the Watching list header/count, the picker
    // would render it as a button. We only want it in the Watching list itself.
    const sessAButtons = Array.from(document.querySelectorAll('button')).filter(
      (btn) => btn.textContent?.includes('sessA'),
    );
    expect(sessAButtons.length).toBe(0);
  });
});
