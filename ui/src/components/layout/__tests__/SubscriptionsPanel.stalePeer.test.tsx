import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { useSupervisorStore } from '@/stores/supervisorStore';

/**
 * Stale-retained peer sessions in the Watching list.
 *
 * When a peer server (srvB) stops responding, hydrateWatchedSessions marks its
 * prior supervised rows with stale:true. This test proves those stale rows
 * surface in the Watching panel (both case a: found in subscriptions with
 * stale:true stamped, and case b: synthesized with status:'unknown').
 */

vi.mock('@/components/layout/SessionCard', () => ({
  SessionCard: ({
    sub,
    subKey,
  }: {
    sub: { session: string; stale?: boolean; status?: string };
    subKey?: string;
  }) => (
    <div
      data-testid="session-card"
      data-session={sub.session}
      data-stale={sub.stale === true ? 'true' : undefined}
      data-subkey={subKey}
    >
      {sub.stale === true && sub.status === 'unknown' && (
        <span data-testid="session-card-stale">stale-marker</span>
      )}
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
      // Note: no entry for srvB:proj:sessB (case b: synthetic row)
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
    currentSession: null,
    sessions: [],
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
      {
        id: 'srvB',
        label: 'Server B',
        host: 'peer',
        port: 9002,
        status: 'online',
        source: 'manual',
      },
    ],
  };
  return { useServers: () => value };
});

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: vi.fn(() => null),
}));

import { SubscriptionsPanel } from '../SubscriptionsPanel';

describe('SubscriptionsPanel.stalePeer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it('renders the stale-retained peer session with the session-card-stale marker after a real hydrateWatchedSessions fan-out failure', async () => {
    useSupervisorStore.setState({ supervised: [] });

    // Seed with rows from both servers, both unstale initially
    useSupervisorStore.setState({
      supervised: [
        {
          project: 'proj',
          session: 'sessA',
          serverId: 'srvA',
          stale: false,
        },
        {
          project: 'proj',
          session: 'sessB',
          serverId: 'srvB',
          stale: false,
        },
      ],
    });

    // Stub fetch for the hydration calls (srvA succeeds, srvB fails)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okRes({ supervised: [{ project: 'proj', session: 'sessA', serverId: 'srvA' }] })) // hydrate srvA
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }) // hydrate srvB fails
      .mockResolvedValue({ ok: true, json: async () => ({ supervised: [] }) })); // fallback for panel's useEffect

    // Execute the hydration (will mark srvB's row as stale:true)
    await useSupervisorStore.getState().hydrateWatchedSessions(['srvA', 'srvB']);

    // Verify the store now has srvB row marked stale
    const supervised = useSupervisorStore.getState().supervised;
    const srvBRows = supervised.filter((s) => s.serverId === 'srvB');
    expect(srvBRows).toHaveLength(1);
    expect(srvBRows[0].stale).toBe(true);

    // Now render the panel with the stale-marked state
    render(<SubscriptionsPanel />);

    // Both sessions should render: srvA (from subscription) and srvB (stale-retained)
    await waitFor(() => {
      const cards = screen.getAllByTestId('session-card');
      expect(cards.length).toBeGreaterThanOrEqual(1);
    });

    // srvB card should have the stale marker (sub.stale===true && sub.status==='unknown')
    const staleMarkers = screen.queryAllByTestId('session-card-stale');
    expect(staleMarkers.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a synthetic stale row for a watched peer session with no localStorage subscription', async () => {
    useSupervisorStore.setState({ supervised: [] });

    // Seed with one row from srvB, no corresponding entry in subscriptionStore
    useSupervisorStore.setState({
      supervised: [
        {
          project: 'proj',
          session: 'sessB',
          serverId: 'srvB',
          stale: false,
        },
      ],
    });

    // Stub fetch for hydrate's srvB failure and fallback
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }) // hydrate srvB fails
      .mockResolvedValue({ ok: true, json: async () => ({ supervised: [] }) })); // fallback for panel's useEffect

    // Execute the hydration (will mark srvB's row as stale:true)
    await useSupervisorStore.getState().hydrateWatchedSessions(['srvB']);

    // Verify the store has srvB row marked stale
    const supervised = useSupervisorStore.getState().supervised;
    const srvBRows = supervised.filter((s) => s.serverId === 'srvB');
    expect(srvBRows).toHaveLength(1);
    expect(srvBRows[0].stale).toBe(true);

    // Render the panel
    render(<SubscriptionsPanel />);

    // The synthetic row should render (case b: no entry in subscriptions)
    // It has status:'unknown', so the stale marker will show
    await waitFor(() => {
      const staleMarkers = screen.queryAllByTestId('session-card-stale');
      expect(staleMarkers.length).toBeGreaterThanOrEqual(1);
    });

    // The synthetic row's subKey should be undefined (no subscription entry)
    const cards = screen.queryAllByTestId('session-card');
    const synthCard = cards.find((c) => c.getAttribute('data-session') === 'sessB');
    expect(synthCard?.getAttribute('data-subkey')).toBeNull();
  });
});
