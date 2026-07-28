import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

/**
 * Selection-time todos fetch: clicking a project row triggers
 * loadProjectTodos to make the newly-selected project's plan stats fresh
 * without waiting for the 10s hydrate sweep.
 */

vi.mock('@/components/layout/SessionCard', () => ({
  SessionCard: ({ sub }: { sub: { session: string } }) => (
    <div data-testid="session-card" data-session={sub.session} />
  ),
  ClaudePixAvatar: ({ status }: { status: string }) => (
    <div data-testid="claudepix" data-status={status} />
  ),
  activateSessionCard: vi.fn(),
}));

vi.mock('@/components/supervisor/SupervisorOnboarding', () => ({
  SupervisorOnboarding: () => <div data-testid="onboarding" />,
}));

vi.mock('@/stores/supervisorStore', () => {
  const loadProjectTodosSpy = vi.fn();
  const state = {
    supervised: [
      { project: '/proj', session: 'sess-a', serverId: 'srv-uuid-123' },
      { project: '/proj', session: 'sess-b', serverId: 'srv-uuid-123' },
      { project: '/projB', session: 'sess-c', serverId: 'srv-uuid-123' },
      { project: '/projB', session: 'sess-d', serverId: 'srv-uuid-123' },
    ],
    escalations: [],
    watchedProjects: [{ project: '/proj' }, { project: '/projB' }],
    todosByProject: {},
    loadProjectTodos: loadProjectTodosSpy,
    config: { supervisorProject: '/proj', supervisorSession: 'sup' },
    liveness: { running: true },
    loadSupervised: vi.fn(),
    loadEscalations: vi.fn(),
    loadConfig: vi.fn(),
    loadLiveness: vi.fn(),
    loadProjects: vi.fn(),
    addProject: vi.fn(),
    removeProject: vi.fn(),
    resolveEscalation: vi.fn(),
    openEscalations: [],
  };
  const useSupervisorStore = (sel?: (s: any) => any) => (sel ? sel(state) : state);
  useSupervisorStore.getState = () => state;
  return { useSupervisorStore, __loadProjectTodosSpy: loadProjectTodosSpy };
});

vi.mock('@/stores/subscriptionStore', () => {
  // Two projects with live subscriptions so both have colored (non-gray) status
  // and render in the list (gray sessions get filtered out).
  const state = {
    subscriptions: {
      'srv-uuid-123|/proj|sess-a': { serverId: 'srv-uuid-123', project: '/proj', session: 'sess-a', status: 'waiting', lastUpdate: Date.now() },
      'srv-uuid-123|/proj|sess-b': { serverId: 'srv-uuid-123', project: '/proj', session: 'sess-b', status: 'active', lastUpdate: Date.now() },
      'srv-uuid-123|/projB|sess-c': { serverId: 'srv-uuid-123', project: '/projB', session: 'sess-c', status: 'waiting', lastUpdate: Date.now() },
      'srv-uuid-123|/projB|sess-d': { serverId: 'srv-uuid-123', project: '/projB', session: 'sess-d', status: 'waiting', lastUpdate: Date.now() },
    },
  };
  return { useSubscriptionStore: (sel: (s: any) => any) => sel(state) };
});

vi.mock('@/stores/sessionStore', () => {
  const state = {
    currentSession: { serverId: 'srv-uuid-123', project: '/proj', name: 'default' },
    sessions: [],
    setCurrentSession: vi.fn(),
  };
  return { useSessionStore: (sel: (s: any) => any) => sel(state) };
});

vi.mock('@/contexts/ServerContext', () => {
  const value = {
    servers: [
      { id: 'srv-uuid-123', label: 'Local', host: 'localhost', port: 9002, status: 'online', source: 'local', icon: 'Rocket' },
    ],
  };
  return { useServers: () => value };
});

vi.mock('@/stores/uiStore', () => {
  const state = { activeProject: null, setActiveProject: vi.fn(), setMode: vi.fn() };
  return { useUIStore: (sel: (s: any) => any) => sel(state) };
});

vi.mock('@/stores/bridgeOrderStore', () => ({
  useBridgeOrderStore: (sel: (s: any) => any) =>
    sel({
      order: [],
      reorder: vi.fn(),
    }),
  applyBridgeOrder: (projects: any[]) => projects,
}));

vi.mock('@/hooks/useFleetStatus', () => ({
  useFleetStatus: () => ({}),
  useFleetStatusByProject: () => ({}),
  fleetKey: (project: string, session: string) => `${project}|${session}`,
  fleetStateToStatus: () => 'unknown',
}));

vi.mock('@/lib/statusSelectors', () => ({
  selectEscalationKindCounts: () => ({
    total: 0,
    blockers: 0,
    landReady: 0,
  }),
}));

import { SupervisorPanel } from '../SupervisorPanel';

describe('SupervisorPanel.selectProject — selection-time todos fetch', () => {
  let loadProjectTodosSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('@/stores/supervisorStore');
    loadProjectTodosSpy = (mod as any).__loadProjectTodosSpy;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls loadProjectTodos immediately when a project row is clicked', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }) as any));

    render(<SupervisorPanel />);

    // After render, the hydrate effect (lines 397-403) will have called loadProjectTodos
    // for both projects. Clear the spy so we can assert only on the selection click.
    loadProjectTodosSpy.mockClear();

    // Find the second project row (/projB) by querying all project headers and
    // finding the one with data-project='/projB'.
    const headers = screen.getAllByTestId('supervisor-project-header');
    const projBHeader = headers.find((h) => h.getAttribute('data-project') === '/projB');
    expect(projBHeader).toBeTruthy();

    // Click the project row.
    fireEvent.click(projBHeader!);

    // Assert loadProjectTodos was called with the correct serverId and project.
    expect(loadProjectTodosSpy).toHaveBeenCalledWith('srv-uuid-123', '/projB');
    expect(loadProjectTodosSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
