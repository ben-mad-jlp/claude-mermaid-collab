/**
 * missionRailProjectMismatch repro (be1b0c01) — quarantined, RED at HEAD.
 *
 * Reproduces: the Header's top-nav session-select handler (App.tsx:1390-1395)
 * calls setCurrentSession() only — it never calls useUIStore's setActiveProject.
 * BridgeDashboard.tsx:139 resolves its `project` as
 * `activeProjectPref ?? currentSession?.project ?? supervised[0]?.project ?? ''`,
 * so once activeProject has been pinned elsewhere (SupervisorPanel, SubscriptionsPanel,
 * FleetGraph, OpsSessionCards), switching projects via the Header dropdown leaves every
 * Bridge mission surface (MissionStrip, MissionDetailPanel, useMissions) rendering the
 * stale pinned project's data while the switcher/localStorage show the new one.
 *
 * This test is excluded from every gate lane by the __quarantine__ path segment and is
 * expected to stay RED until a real fix lands (activeProject should be cleared/updated
 * on Header project switch). Do not weaken the assertion to pass.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

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

import { BridgeDashboard } from '../../../BridgeDashboard';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';

const STALE_PINNED_PROJECT = '/Users/benmaderazo/Code/claude-mermaid-collab';
const HEADER_SWITCHED_PROJECT = '/Users/benmaderazo/Code/build123d-ocp-mcp';

const capturedMissionsProjects: string[] = [];

const mockFetch = vi.fn(async (url: string | Request) => {
  const raw = typeof url === 'string' ? url : url.url;
  const parsed = new URL(raw, 'http://localhost');
  const pathname = parsed.pathname;

  if (pathname === '/api/supervisor/bridge-snapshot') {
    capturedMissionsProjects.push(parsed.searchParams.get('project') ?? '');
    return { ok: true, json: async () => ({ projects: [], todos: [], openEscalations: [], coverage: {} }) };
  }

  return {
    ok: true,
    json: async () => {
      if (pathname === '/api/supervisor/unlanded-epics') return { unlandedEpics: [] };
      if (pathname === '/api/supervisor/escalations') return { escalations: [] };
      if (pathname === '/api/supervisor/audit') return { entries: [] };
      if (pathname === '/api/supervisor/requirements') return { requirements: [] };
      return {};
    },
  };
});

beforeEach(() => {
  connectHandlers.clear();
  messageHandlers.clear();
  capturedMissionsProjects.length = 0;
  global.fetch = mockFetch as any;

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
  } as any);

  // Bridge was pinned to A elsewhere (e.g. SupervisorPanel.handleSelectProject,
  // SubscriptionsPanel, FleetGraph node-click, OpsSessionCards).
  useUIStore.setState({ activeProject: STALE_PINNED_PROJECT } as any);

  // The Header dropdown then switched sessions to project B. Its only side effect
  // (App.tsx:1390-1395 handleSessionSelect) is setCurrentSession — it never touches
  // useUIStore's activeProject.
  useSessionStore.setState({
    currentSession: { project: HEADER_SWITCHED_PROJECT, name: 's', serverId: 'local' },
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('missionRailProjectMismatch repro (be1b0c01)', () => {
  it("renders missions from the stale pinned activeProject, not the current session's project, after a Header-dropdown project switch", async () => {
    render(<BridgeDashboard />);

    await waitFor(() => {
      expect(capturedMissionsProjects.length).toBeGreaterThan(0);
    });

    // Expected (user-facing) behavior: Bridge should follow the Header dropdown's
    // current session project, since that's the project the user just switched to.
    expect(capturedMissionsProjects[0]).toBe(HEADER_SWITCHED_PROJECT);
  });
});
