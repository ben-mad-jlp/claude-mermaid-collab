/**
 * Session switch reconciliation (be1b0c01) — fixed via reconcileScopeOnSessionSelect.
 *
 * Verifies: the Header's top-nav session-select handler calls
 * reconcileScopeOnSessionSelect, which updates BOTH currentSession AND activeProject.
 * BridgeDashboard.tsx:139 resolves its `project` as
 * `activeProjectPref ?? currentSession?.project ?? supervised[0]?.project ?? ''`,
 * so when the user switches projects via the Header dropdown, every Bridge mission
 * surface (MissionStrip, MissionDetailPanel, useMissions) now renders the new
 * project's data, not a stale pinned one.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';

const connectHandlers = new Set<() => void>();
const messageHandlers = new Set<(msg: any) => void>();
const fakeClient = {
  onConnect: (h: () => void) => {
    connectHandlers.add(h);
    return { unsubscribe: () => connectHandlers.delete(h) };
  },
  onMessage: (h: (msg: any) => void) => {
    messageHandlers.add(h);
    return { unsubscribe: () => messageHandlers.delete(h) };
  },
};
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => fakeClient,
}));

vi.mock('../../../SplitDeck', () => ({ SplitDeck: () => <div data-testid="bridge-split-deck" /> }));
vi.mock('../../../focal/DecisionCard', () => ({ DecisionCard: () => null }));
vi.mock('@/hooks/useDiveIn', () => ({
  useDiveIn: () => vi.fn(),
  useSelectSessionInPlace: () => vi.fn(),
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/config/featureFlags', () => ({ useFeatureFlags: () => ({ jsonRenderDecisionCard: false }) }));

import { BridgeDashboard } from '../../BridgeDashboard';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { reconcileScopeOnSessionSelect } from '@/lib/sessionScope';

const STALE_PINNED_PROJECT = '/Users/benmaderazo/Code/claude-mermaid-collab';
const HEADER_SWITCHED_PROJECT = '/Users/benmaderazo/Code/build123d-ocp-mcp';

const capturedMissionsProjects: string[] = [];

const mockFetch = vi.fn(async (url: string | Request) => {
  const raw = typeof url === 'string' ? url : url.url;
  const parsed = new URL(raw, 'http://localhost');
  const pathname = parsed.pathname;

  if (pathname === '/api/supervisor/bridge-snapshot') {
    return { ok: true, json: async () => ({ projects: [], todos: [], openEscalations: [], coverage: {} }) };
  }

  return {
    ok: true,
    json: async () => {
      if (pathname === '/api/supervisor/unlanded-epics') return { unlandedEpics: [] };
      if (pathname === '/api/supervisor/escalations') return { escalations: [] };
      if (pathname === '/api/supervisor/audit') return { entries: [] };
      if (pathname === '/api/supervisor/requirements') return { requirements: [] };
      if (pathname === '/api/supervisor/missions') return { missions: [] };
      return {};
    },
  };
});

beforeEach(() => {
  connectHandlers.clear();
  messageHandlers.clear();
  capturedMissionsProjects.length = 0;
  global.fetch = mockFetch as any;

  // Mock fetchMissions to return different data based on project
  const mockFetchMissions = vi.fn(async (serverId: string, project: string) => {
    capturedMissionsProjects.push(project);

    return project === HEADER_SWITCHED_PROJECT
      ? [
          {
            node: { id: 'm-switched-1', title: 'Switched Mission', status: 'active', nickname: 'switched-m1' },
            ownerSession: null,
            assigneeSession: null,
            mission: { todoId: 'm-switched-1', phase: 'execute' as const, iteration: 1 },
            rollup: { phase: 'execute' as const, iteration: 1, mechanical: { done: 0, total: 1 }, capability: { met: 1, total: 2 } },
            criteria: [
              { id: 'c1', text: 'Switched criterion 1', met: true, order: 1 },
              { id: 'c2', text: 'Switched criterion 2', met: false, order: 2 },
            ],
            epics: [],
          },
        ]
      : [
          {
            node: { id: 'm-stale-1', title: 'Stale Mission', status: 'active', nickname: 'stale-m1' },
            ownerSession: null,
            assigneeSession: null,
            mission: { todoId: 'm-stale-1', phase: 'execute' as const, iteration: 1 },
            rollup: { phase: 'execute' as const, iteration: 1, mechanical: { done: 0, total: 1 }, capability: { met: 0, total: 1 } },
            criteria: [{ id: 'c1', text: 'Stale criterion', met: false, order: 1 }],
            epics: [],
          },
        ];
  });

  useSupervisorStore.setState({
    escalations: [],
    openEscalations: [],
    watchedProjects: [
      { project: STALE_PINNED_PROJECT, addedAt: 1 },
      { project: HEADER_SWITCHED_PROJECT, addedAt: 1 },
    ],
    todosByProject: {},
    unlandedEpicsByProject: {},
    coverageByProject: {},
    auditByProject: {},
    requirementsByProject: {},
    bridgeSnapshotStateByProject: {},
    fetchMissions: mockFetchMissions,
  } as any);

  // Start with both session and pin on the stale project
  useUIStore.setState({ activeProject: STALE_PINNED_PROJECT } as any);
  useSessionStore.setState({
    currentSession: { project: STALE_PINNED_PROJECT, name: 's1', serverId: 'local' },
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('session switch reconciles Bridge project scope', () => {
  it('follows the current session\'s project after a reconciled Header switch', async () => {
    // Before: both on stale project
    expect(useSessionStore.getState().currentSession?.project).toBe(STALE_PINNED_PROJECT);
    expect(useUIStore.getState().activeProject).toBe(STALE_PINNED_PROJECT);

    // Reconcile: Header calls reconcileScopeOnSessionSelect with new session
    reconcileScopeOnSessionSelect(
      { project: HEADER_SWITCHED_PROJECT, name: 's2', serverId: 'local' },
      {
        setCurrentSession: (s) => useSessionStore.setState({ currentSession: s }),
        setActiveProject: (p) => useUIStore.setState({ activeProject: p }),
      }
    );

    // After: both updated to switched project
    expect(useSessionStore.getState().currentSession?.project).toBe(HEADER_SWITCHED_PROJECT);
    expect(useUIStore.getState().activeProject).toBe(HEADER_SWITCHED_PROJECT);

    render(<BridgeDashboard />);

    await waitFor(() => {
      expect(capturedMissionsProjects.length).toBeGreaterThan(0);
    });

    // Bridge fetches from the switched project, not the stale one
    expect(capturedMissionsProjects[0]).toBe(HEADER_SWITCHED_PROJECT);
  });

  it('after reconciliation, fetches and loads the switched project\'s mission data', async () => {
    // Reset captured projects and mock
    capturedMissionsProjects.length = 0;

    // Set up initial state: both on stale project
    useSessionStore.setState({
      currentSession: { project: STALE_PINNED_PROJECT, name: 's1', serverId: 'local' },
    } as any);
    useUIStore.setState({ activeProject: STALE_PINNED_PROJECT } as any);

    // Reconcile to switched project
    reconcileScopeOnSessionSelect(
      { project: HEADER_SWITCHED_PROJECT, name: 's2', serverId: 'local' },
      {
        setCurrentSession: (s) => useSessionStore.setState({ currentSession: s }),
        setActiveProject: (p) => useUIStore.setState({ activeProject: p }),
      }
    );

    // Verify state was updated
    expect(useSessionStore.getState().currentSession?.project).toBe(HEADER_SWITCHED_PROJECT);
    expect(useUIStore.getState().activeProject).toBe(HEADER_SWITCHED_PROJECT);

    // Render BridgeDashboard which will call useMissions
    render(<BridgeDashboard />);

    // Wait for the BridgeRail to mount
    await waitFor(() => {
      expect(screen.getByTestId('bridge-rail')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Verify that fetchMissions was called and it fetched the switched project, not the stale one
    await waitFor(() => {
      expect(capturedMissionsProjects.length).toBeGreaterThan(0);
    });

    // The most recent fetch should be from the switched project
    expect(capturedMissionsProjects[capturedMissionsProjects.length - 1]).toBe(HEADER_SWITCHED_PROJECT);
  });

  it('a pin-only activeProject update (no session change) still scopes Bridge to the pinned project', async () => {
    // Set up: currentSession on switched project, but pin on stale project
    useSessionStore.setState({
      currentSession: { project: HEADER_SWITCHED_PROJECT, name: 's2', serverId: 'local' },
    } as any);

    // Pin directly to stale project (simulating FleetGraph/CommandBarBadge)
    useUIStore.setState({ activeProject: STALE_PINNED_PROJECT } as any);

    render(<BridgeDashboard />);

    await waitFor(() => {
      expect(capturedMissionsProjects.length).toBeGreaterThan(0);
    });

    // Despite currentSession being on switched project, the pin wins
    expect(capturedMissionsProjects[0]).toBe(STALE_PINNED_PROJECT);
  });
});
