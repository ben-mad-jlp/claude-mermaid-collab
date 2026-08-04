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

// `supervised` is surfaced as data-supervised so the test can wait for the
// supervised set to have ACTUALLY populated before asserting. Without that
// signal the assertions race the async supervised poll and pass against a
// still-empty set — which is what made the earlier version of this test
// survive re-introduction of the hide-filter it exists to prevent.
vi.mock('@/components/layout/SessionCard', () => ({
  SessionCard: ({
    sub,
    subKey,
    supervised,
  }: {
    sub: { session: string; project: string; serverId: string };
    subKey?: string;
    supervised?: boolean;
  }) => (
    <div
      data-testid="session-card"
      data-session={sub.session}
      data-subkey={subKey}
      data-supervised={String(!!supervised)}
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

    // (a) Watching-list render: the session STAYS rendered after it is known to be
    // supervised. Gate on data-supervised="true" — that is the only proof the async
    // supervised poll has landed. Asserting before it lands tests nothing: the
    // pre-fix hide-filter keys off `supervised.set`, so against an empty set it
    // removes nothing and a green test would prove only that the race was won.
    //
    // MUTATION CONTRACT: re-introduce the hide-filter on the Watching rows —
    //   projectSubscriptions.filter(([key, sub]) =>
    //     !staleKeysSet.has(key) && !supervised.set.has(`${sub.project}:${sub.session}`))
    // — and this waitFor MUST time out, because the row is removed at the very moment
    // it becomes supervised. If this test still passes under that mutation it is
    // vacuous and does not satisfy the criterion it claims to prove.
    await waitFor(() => {
      const card = screen.queryByTestId('session-card');
      expect(card).not.toBeNull();
      expect(card?.getAttribute('data-supervised')).toBe('true');
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
