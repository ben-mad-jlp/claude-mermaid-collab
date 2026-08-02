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
 *
 * DE-PINNED (mission 0231f07c crit_5): resyncBridge no longer fans out over the
 * granular per-source loaders — it issues ONE `loadBridgeSnapshot` for the active
 * project plus the three sources the composite does not subsume (audit /
 * requirements / unlanded-epics). This test pinned the RETIRED set
 * (loadEscalations + loadProjectTodos), so the landed rewire redded it. The
 * guarded intent is unchanged — a reconnect must re-fetch the current scope — so
 * the assertions move onto the CURRENT resync set rather than being deleted.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// --- Fake WS client: capture the onConnect handler so the test can fire it. ---
const connectHandlers = new Set<() => void>();
const messageHandlers = new Set<(msg: any) => void>();
const fakeClient = {
  onConnect: (h: () => void) => {
    connectHandlers.add(h);
    return { unsubscribe: () => connectHandlers.delete(h) };
  },
  // Live-refresh subscription (d1367b0: session_todos_updated; + escalation_created).
  // Captured so the test can simulate broadcasts and so mounting doesn't throw.
  onMessage: (h: (msg: any) => void) => {
    messageHandlers.add(h);
    return { unsubscribe: () => messageHandlers.delete(h) };
  },
};
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => fakeClient,
}));

// --- Stub the heavy presentational children (FleetGraph pulls in reactflow). ---
vi.mock('./SplitDeck', () => ({ SplitDeck: () => <div data-testid="split-deck" /> }));
vi.mock('./CommandBar', () => ({ CommandBar: () => null }));
vi.mock('./NeedsYouZone', () => ({ NeedsYouZone: () => null }));
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

// The CURRENT resync set: one composite snapshot + the three sources it does
// not subsume. loadEscalations/loadProjectTodos are still stubbed because the WS
// message handler uses them — but they are no longer on the resync path.
const loadBridgeSnapshot = vi.fn(async () => {});
const loadAudit = vi.fn(async () => {});
const loadRequirements = vi.fn(async () => {});
const loadUnlandedEpics = vi.fn(async () => {});
const loadEscalations = vi.fn(async () => {});
const loadProjectTodos = vi.fn(async () => {});

beforeEach(() => {
  connectHandlers.clear();
  messageHandlers.clear();
  loadBridgeSnapshot.mockClear();
  loadAudit.mockClear();
  loadRequirements.mockClear();
  loadUnlandedEpics.mockClear();
  loadEscalations.mockClear();
  loadProjectTodos.mockClear();

  // Seed a project so the loaders actually run.
  useUIStore.setState({ activeProject: 'P' } as any);
  useSessionStore.setState({ currentSession: { project: 'P', serverId: 'local' } } as any);
  useSupervisorStore.setState({
    escalations: [],
    supervised: [],
    todosByProject: {},
    auditByProject: {},
    loadBridgeSnapshot,
    loadAudit,
    loadRequirements,
    loadUnlandedEpics,
    loadEscalations,
    loadProjectTodos,
  } as any);
});

describe('BridgeDashboard post-reconnect resync', () => {
  it('re-runs the Bridge loaders when the WS client reconnects', () => {
    render(<BridgeDashboard />);

    // Initial mount loaded once.
    expect(loadBridgeSnapshot).toHaveBeenCalledTimes(1);
    expect(loadAudit).toHaveBeenCalledTimes(1);
    expect(loadRequirements).toHaveBeenCalledTimes(1);
    expect(loadUnlandedEpics).toHaveBeenCalledTimes(1);

    // A handler was registered on the WS client.
    expect(connectHandlers.size).toBe(1);

    // Simulate a socket drop→reconnect: fire onConnect.
    connectHandlers.forEach((h) => h());

    // Every loader re-ran for the current scope — the Bridge is no longer stale.
    expect(loadBridgeSnapshot).toHaveBeenCalledTimes(2);
    expect(loadAudit).toHaveBeenCalledTimes(2);
    expect(loadRequirements).toHaveBeenCalledTimes(2);
    expect(loadUnlandedEpics).toHaveBeenCalledTimes(2);
  });

  it('resyncs via the composite snapshot, not the retired per-source fan-out', () => {
    render(<BridgeDashboard />);
    connectHandlers.forEach((h) => h());

    // Two resyncs (mount + reconnect) drove exactly two snapshot requests...
    expect(loadBridgeSnapshot).toHaveBeenCalledTimes(2);
    // ...and ZERO calls to the per-source loaders the snapshot subsumed. This is
    // the clause that keeps the cold-load fan-out from creeping back in.
    expect(loadEscalations).not.toHaveBeenCalled();
    expect(loadProjectTodos).not.toHaveBeenCalled();

    // NON-VACUITY: those reconnect zeros are real absences, not dead stubs. crit_6
    // RETIRED the per-source loadProjectTodos fan-out — session_todos_updated now drives
    // a DEBOUNCED composite refetchSnapshot (BridgeDashboard.tsx:198-202), not
    // loadProjectTodos — so the surviving SYNCHRONOUS per-source path is
    // escalation_created → loadEscalations (:211-212). Driving it makes that very counter
    // rise, proving the spy is live and the reconnect zeros are genuine (not a broken stub).
    messageHandlers.forEach((h) => h({ type: 'escalation_created' }));
    expect(loadEscalations).toHaveBeenCalledTimes(1);
  });
});
