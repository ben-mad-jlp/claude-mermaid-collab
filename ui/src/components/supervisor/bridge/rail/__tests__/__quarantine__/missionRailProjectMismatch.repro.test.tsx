/**
 * missionRailProjectMismatch repro (be1b0c01) — QUARANTINED, expected RED.
 *
 * Reproduces: after Bridge is pinned to project A elsewhere (useUIStore.activeProject),
 * and the Header's top-nav session dropdown switches to project B (which only calls
 * useSessionStore.setCurrentSession — see App.tsx handleSessionSelect, wired to
 * Header's onSessionSelect — and never calls useUIStore.setActiveProject),
 * BridgeDashboard.tsx's `activeProjectPref ?? currentSession?.project ?? ...` keeps
 * preferring the stale pinned project A. Every Bridge mission consumer fed by that one
 * `project` variable (MissionStrip, MissionDetailPanel, useMissions) goes on rendering
 * project A's data while the switcher/localStorage both show B.
 *
 * This file is excluded from every gate lane by the __quarantine__ path segment and
 * must stay RED until a real fix lands (do not weaken the assertion to pass).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// --- Fake WS client. ---
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

// --- Stub presentational children. ---
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
const SWITCHED_TO_PROJECT = '/Users/benmaderazo/Code/build123d-ocp-mcp';

// --- Mocked fetch, capturing the `project` query-string value of missions requests. ---
let capturedMissionsProject: string | null = null;

const mockFetch = vi.fn(async (url: string | Request) => {
  const raw = typeof url === 'string' ? url : url.url;
  const parsed = new URL(raw, 'http://localhost');

  if (parsed.pathname === '/api/supervisor/missions' || parsed.pathname === '/api/supervisor/bridge-snapshot') {
    capturedMissionsProject = parsed.searchParams.get('project');
  }

  return {
    ok: true,
    json: async () => {
      if (parsed.pathname === '/api/supervisor/bridge-snapshot') return { projects: [], todos: [], openEscalations: [], coverage: {} };
      if (parsed.pathname === '/api/supervisor/missions') return { missions: [] };
      if (parsed.pathname === '/api/supervisor/unlanded-epics') return { unlandedEpics: [] };
      if (parsed.pathname === '/api/supervisor/escalations') return { escalations: [] };
      if (parsed.pathname === '/api/supervisor/audit') return { entries: [] };
      if (parsed.pathname === '/api/supervisor/requirements') return { requirements: [] };
      return {};
    },
  };
});

beforeEach(() => {
  connectHandlers.clear();
  messageHandlers.clear();
  capturedMissionsProject = null;
  global.fetch = mockFetch as any;

  useSupervisorStore.setState({
    escalations: [],
    openEscalations: [],
    watchedProjects: [
      { project: STALE_PINNED_PROJECT, addedAt: 1 },
      { project: SWITCHED_TO_PROJECT, addedAt: 1 },
    ],
    todosByProject: {},
    unlandedEpicsByProject: {},
    coverageByProject: {},
    auditByProject: {},
    requirementsByProject: {},
    bridgeSnapshotStateByProject: {},
  } as any);

  // Bridge was pinned to A elsewhere (e.g. SupervisorPanel.handleSelectProject or
  // FleetGraph's node-click) BEFORE the Header dropdown switch below.
  useUIStore.setState({ activeProject: STALE_PINNED_PROJECT } as any);

  // The Header dropdown's ONLY side effect (App.tsx handleSessionSelect,
  // App.tsx:1390-1395) is setCurrentSession — it never calls setActiveProject.
  useSessionStore.setState({
    currentSession: { project: SWITCHED_TO_PROJECT, name: 's', serverId: 'local' },
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('missionRailProjectMismatch repro (be1b0c01)', () => {
  it("renders missions from the stale pinned activeProject, not the current session's project, after a Header-dropdown project switch", async () => {
    render(<BridgeDashboard />);

    await waitFor(() => {
      expect(capturedMissionsProject).not.toBeNull();
    });

    // Expected (post-fix) behavior: Bridge should follow the Header's session
    // switch and request data for the project the user just selected there.
    expect(capturedMissionsProject).toBe(SWITCHED_TO_PROJECT);
  });
});
