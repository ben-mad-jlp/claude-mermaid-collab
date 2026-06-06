/**
 * BridgeDashboard — post-reconnect resync (BUG FIX).
 *
 * The WS client auto-reconnects after a drop (the API server restarts often),
 * but the Bridge load effect keys only on [serverScope, project], so on
 * reconnect nothing re-fetched and the funnel/graph/roster/stream stayed stale
 * until a project-switch or hard reload. The fix registers a client.onConnect
 * handler that re-runs every loader for the current scope. This test simulates
 * a WS close→reopen (by firing the captured onConnect handler) and asserts the
 * Bridge loaders re-run.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// --- Fake WS client: capture the onConnect handler so the test can fire it. ---
const connectHandlers = new Set<() => void>();
const fakeClient = {
  onConnect: (h: () => void) => {
    connectHandlers.add(h);
    return { unsubscribe: () => connectHandlers.delete(h) };
  },
};
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => fakeClient,
}));

// --- Stub the heavy presentational children (FleetGraph pulls in reactflow). ---
vi.mock('./SplitDeck', () => ({ SplitDeck: () => <div data-testid="split-deck" /> }));
vi.mock('./CommandBar', () => ({ CommandBar: () => null }));
vi.mock('./NeedsYouZone', () => ({ NeedsYouZone: () => null }));
vi.mock('./FleetVitals', () => ({ FleetVitals: () => null }));
vi.mock('./WorkerRoster', () => ({ WorkerRoster: () => null }));
vi.mock('./StreamTicker', () => ({ StreamTicker: () => null }));
vi.mock('./fleet/FleetGraph', () => ({ FleetGraph: () => null }));
vi.mock('./focal/DecisionCard', () => ({ DecisionCard: () => null }));
vi.mock('@/components/layout/SplitPane', () => ({ SplitPane: () => null }));

// --- Stub hooks. ---
vi.mock('@/hooks/useDiveIn', () => ({
  useDiveIn: () => vi.fn(),
  useSelectSessionInPlace: () => vi.fn(),
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/config/featureFlags', () => ({ useFeatureFlags: () => ({ jsonRenderDecisionCard: false }) }));

import { BridgeDashboard } from './BridgeDashboard';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';

const loadEscalations = vi.fn(async () => {});
const loadProjectTodos = vi.fn(async () => {});
const loadCoordinator = vi.fn(async () => {});
const loadAudit = vi.fn(async () => {});

beforeEach(() => {
  connectHandlers.clear();
  loadEscalations.mockClear();
  loadProjectTodos.mockClear();
  loadCoordinator.mockClear();
  loadAudit.mockClear();

  // Seed a project so the loaders actually run.
  useUIStore.setState({ activeProject: 'P' } as any);
  useSessionStore.setState({ currentSession: { project: 'P', serverId: 'local' } } as any);
  useSupervisorStore.setState({
    escalations: [],
    supervised: [],
    todosByProject: {},
    coordinatorByProject: {},
    auditByProject: {},
    loadEscalations,
    loadProjectTodos,
    loadCoordinator,
    loadAudit,
  } as any);
});

describe('BridgeDashboard post-reconnect resync', () => {
  it('re-runs the Bridge loaders when the WS client reconnects', () => {
    render(<BridgeDashboard />);

    // Initial mount loaded once.
    expect(loadEscalations).toHaveBeenCalledTimes(1);
    expect(loadProjectTodos).toHaveBeenCalledTimes(1);
    expect(loadCoordinator).toHaveBeenCalledTimes(1);
    expect(loadAudit).toHaveBeenCalledTimes(1);

    // A handler was registered on the WS client.
    expect(connectHandlers.size).toBe(1);

    // Simulate a socket drop→reconnect: fire onConnect.
    connectHandlers.forEach((h) => h());

    // Every loader re-ran for the current scope — the Bridge is no longer stale.
    expect(loadEscalations).toHaveBeenCalledTimes(2);
    expect(loadProjectTodos).toHaveBeenCalledTimes(2);
    expect(loadCoordinator).toHaveBeenCalledTimes(2);
    expect(loadAudit).toHaveBeenCalledTimes(2);
  });
});
