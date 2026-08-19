/**
 * BridgeDashboard — end-to-end proof that selecting a session (the real
 * useSelectSessionInPlace path) flips the active project and the ladder's
 * level state persists for THAT project, not the previously-active one.
 *
 * Unlike BridgeDashboard.focal.test.tsx, this test does NOT mock
 * `@/hooks/useDiveIn` (useSelectSessionInPlace runs for real) and stubs
 * `./SplitDeck` to actually render `commandBar`, so the real CommandBar →
 * OrchestratorLadder chain mounts.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

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

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

vi.mock('./SplitDeck', () => ({
  SplitDeck: ({ commandBar }: any) => <div>{commandBar}</div>,
}));

import { BridgeDashboard } from './BridgeDashboard';
import { useSelectSessionInPlace } from '@/hooks/useDiveIn';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';

const PROJECT_A = '/abs/a';
const PROJECT_B = '/abs/b';

const loadEscalations = vi.fn(async () => {});
const loadProjectTodos = vi.fn(async () => {});
const loadAudit = vi.fn(async () => {});
const loadRequirements = vi.fn(async () => {});
const loadCoverage = vi.fn(async () => {});
const loadBridgeSnapshot = vi.fn(async () => {});
const loadUnlandedEpics = vi.fn(async () => {});

/** Sibling harness component: exercises the real shared selection path. */
const SelectProjectB: React.FC = () => {
  const selectInPlace = useSelectSessionInPlace();
  return (
    <button
      data-testid="select-project-b"
      onClick={() => selectInPlace({ project: PROJECT_B, session: 'session-b' })}
    >
      select b
    </button>
  );
};

describe('BridgeDashboard project selection persists the ladder level', () => {
  let resolveBGet: (v: any) => void;
  let posts: any[];

  beforeEach(() => {
    connectHandlers.clear();
    messageHandlers.clear();
    loadEscalations.mockClear();
    loadProjectTodos.mockClear();
    loadAudit.mockClear();
    loadRequirements.mockClear();
    loadCoverage.mockClear();
    loadBridgeSnapshot.mockClear();
    loadUnlandedEpics.mockClear();

    useUIStore.setState({ activeProject: PROJECT_A } as any);
    useSessionStore.setState({
      sessions: [
        { project: PROJECT_A, name: 'session-a', serverId: 'local' },
        { project: PROJECT_B, name: 'session-b', serverId: 'local' },
      ],
      currentSession: { project: PROJECT_A, name: 'session-a', serverId: 'local' },
    } as any);
    useSupervisorStore.setState({
      escalations: [],
      supervised: [],
      todosByProject: {},
      auditByProject: {},
      unlandedEpicsByProject: {},
      requirementsByProject: {},
      coverageByProject: {},
      watchedProjects: [],
      loadEscalations,
      loadProjectTodos,
      loadAudit,
      loadRequirements,
      loadCoverage,
      loadBridgeSnapshot,
      loadUnlandedEpics,
    } as any);

    posts = [];
    const pendingBGet = new Promise((r) => { resolveBGet = r; });

    const normalizePath = (raw: string): string => {
      try {
        const parsed = new URL(raw, 'http://localhost');
        const pathAndQuery = parsed.pathname + parsed.search;
        return pathAndQuery.replace(/^\/srv\/[^/]+/, '');
      } catch {
        return raw;
      }
    };

    global.fetch = vi.fn((url: any, init?: any) => {
      const path = normalizePath(String(url));
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path.startsWith('/api/orchestrator/level')) {
        posts.push(JSON.parse(init.body));
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      if (method === 'GET' && path === `/api/orchestrator/level?project=${encodeURIComponent(PROJECT_A)}`) {
        return Promise.resolve({ ok: true, json: async () => ({ level: 'off' }) });
      }
      if (method === 'GET' && path === `/api/orchestrator/level?project=${encodeURIComponent(PROJECT_B)}`) {
        return pendingBGet.then(() => ({ ok: true, json: async () => ({ level: 'off' }) }));
      }
      if (method === 'GET' && path === '/api/orchestrator/health') {
        return Promise.resolve({ ok: true, json: async () => ({ running: true }) });
      }
      if (method === 'POST' && path === '/api/browser/focus-tab') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    }) as any;
  });

  it('raising the ladder after selecting a session persists the level for the newly selected project, not the previous one', async () => {
    render(
      <>
        <BridgeDashboard />
        <SelectProjectB />
      </>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-project')).toBe(PROJECT_A),
    );

    fireEvent.click(screen.getByTestId('select-project-b'));

    await waitFor(() =>
      expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-project')).toBe(PROJECT_B),
    );

    fireEvent.click(screen.getByTestId('orchestrator-stop-on'));

    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toEqual({ project: PROJECT_B, level: 'on' });

    resolveBGet(undefined);
    await waitFor(() => {});
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByTestId('orchestrator-ladder').getAttribute('data-level')).toBe('on');
    expect(screen.getByTestId('orchestrator-stop-on').getAttribute('data-active')).toBe('true');
  });
});
