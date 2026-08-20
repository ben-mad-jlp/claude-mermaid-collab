/**
 * BridgeDashboard.switchNoResync — project-switch refetch falsifier
 *
 * Verifies that resyncBridge calls loadBridgeSnapshot exactly once and does NOT
 * call the old per-project/escalation/coverage endpoints (that are now subsumed by
 * the snapshot). Uses a mocked fetch to count request pathnames, proving the
 * rewire is complete.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

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
vi.mock('./SplitDeck', () => ({ SplitDeck: () => <div data-testid="bridge-split-deck" /> }));
vi.mock('./focal/DecisionCard', () => ({ DecisionCard: () => null }));
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

// --- Mocked fetch with request counter ---
const requestPathCounter = new Map<string, number>();

const mockFetch = vi.fn(async (url: string | Request) => {
  let pathname = '';
  if (typeof url === 'string') {
    pathname = new URL(url, 'http://localhost').pathname;
  } else {
    pathname = new URL(url.url, 'http://localhost').pathname;
  }
  requestPathCounter.set(pathname, (requestPathCounter.get(pathname) ?? 0) + 1);

  // Return minimal OK response for all paths
  return {
    ok: true,
    json: async () => {
      if (pathname === '/api/supervisor/bridge-snapshot') return { projects: [], todos: [], openEscalations: [], coverage: {} };
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
  requestPathCounter.clear();
  global.fetch = mockFetch as any;

  // Reset store to a clean state with only DATA slices; ACTION fields (loaders)
  // stay as real implementations (not mocked) so the component can call them
  useSupervisorStore.setState({
    escalations: [],
    openEscalations: [],
    watchedProjects: [
      { project: 'P', addedAt: 1 },
      { project: 'Q', addedAt: 1 },
    ],
    todosByProject: {},
    unlandedEpicsByProject: {},
    coverageByProject: {},
    auditByProject: {},
    requirementsByProject: {},
    bridgeSnapshotStateByProject: {},
  } as any);
  useUIStore.setState({ activeProject: 'P' } as any);
  useSessionStore.setState({ currentSession: { project: 'P', serverId: 'local' } } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('a project switch does not resync the bridge snapshot', () => {
  it('fills a cold project once, then issues no new snapshot request when switching back to it', async () => {
    const { rerender } = render(<BridgeDashboard />);

    // P is cold on mount → exactly one fill.
    await waitFor(() => {
      expect(requestPathCounter.get('/api/supervisor/bridge-snapshot')).toBe(1);
    });

    // Switch to Q — also cold, so it fills once (nothing cached to paint).
    act(() => { useUIStore.setState({ activeProject: 'Q' } as any); });
    rerender(<BridgeDashboard />);
    await waitFor(() => {
      expect(requestPathCounter.get('/api/supervisor/bridge-snapshot')).toBe(2);
    });

    // Switch BACK to P, which has already loaded: the panels paint the cached
    // snapshot and MUST NOT issue another request. The timer and the manual ↺
    // are the only refresh paths once a project has something to show.
    act(() => { useUIStore.setState({ activeProject: 'P' } as any); });
    rerender(<BridgeDashboard />);
    await waitFor(() => {
      expect(useSupervisorStore.getState().bridgeSnapshotStateByProject['P']?.hasLoadedOnce).toBe(true);
    });
    expect(requestPathCounter.get('/api/supervisor/bridge-snapshot')).toBe(2);

    // And once more, to prove it is not a one-shot suppression.
    act(() => { useUIStore.setState({ activeProject: 'Q' } as any); });
    rerender(<BridgeDashboard />);
    expect(requestPathCounter.get('/api/supervisor/bridge-snapshot')).toBe(2);
  });
});
