import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

/**
 * Per-project grouping (collapsible header + dancing-Claude avatar + combined
 * worker-state color). Two layers: pure reducers (combineCardStatus /
 * projectHeaderBg) and a render assertion that the project header mounts with the
 * avatar and the combined-state attribute.
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
  const state = {
    supervised: [
      { project: '/proj', session: 'sess-a', serverId: 'local' },
      { project: '/proj', session: 'sess-b', serverId: 'local' },
    ],
    escalations: [],
    watchedProjects: [{ project: '/proj' }],
    coordinatorByProject: {},
    config: { supervisorProject: '/proj', supervisorSession: 'sup' },
    liveness: { running: true },
    loadSupervised: vi.fn(),
    loadEscalations: vi.fn(),
    loadConfig: vi.fn(),
    loadLiveness: vi.fn(),
    loadProjects: vi.fn(),
    loadCoordinator: vi.fn(),
    addProject: vi.fn(),
    removeProject: vi.fn(),
    resolveEscalation: vi.fn(),
  };
  return { useSupervisorStore: (sel?: (s: any) => any) => (sel ? sel(state) : state) };
});

vi.mock('@/stores/subscriptionStore', () => ({
  useSubscriptionStore: (sel: (s: any) => any) => sel({ subscriptions: {} }),
}));

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (sel: (s: any) => any) =>
    sel({ currentSession: null, sessions: [], setCurrentSession: vi.fn() }),
}));

vi.mock('@/stores/terminalStore', () => ({
  useTerminalStore: { getState: () => ({ openFor: vi.fn() }) },
}));

vi.mock('@/contexts/ServerContext', () => ({
  useServers: () => ({
    servers: [
      { id: 'srv-uuid-123', label: 'Local', host: 'localhost', port: 9002, status: 'online', source: 'local', icon: 'Rocket' },
    ],
  }),
}));

import { SupervisorPanel, combineCardStatus, projectHeaderBg } from '../SupervisorPanel';

describe('combineCardStatus — reduce per-project health to one status', () => {
  it('escalates to permission (RED) when any card needs permission', () => {
    expect(combineCardStatus(['waiting', 'permission', 'active'])).toBe('permission');
  });
  it('is active (AMBER) when any card is active and none need permission', () => {
    expect(combineCardStatus(['waiting', 'active', 'unknown'])).toBe('active');
  });
  it('is waiting (GREEN) when all are waiting/idle', () => {
    expect(combineCardStatus(['waiting', 'waiting'])).toBe('waiting');
  });
  it('is unknown (GREY) when there is nothing actionable', () => {
    expect(combineCardStatus(['unknown', 'unknown'])).toBe('unknown');
    expect(combineCardStatus([])).toBe('unknown');
  });
});

describe('projectHeaderBg — mirrors the SessionCard statusBg palette', () => {
  it('maps each combined status to the right color family', () => {
    expect(projectHeaderBg('permission')).toContain('danger');
    expect(projectHeaderBg('active')).toContain('warning');
    expect(projectHeaderBg('waiting')).toContain('success');
    expect(projectHeaderBg('unknown')).toContain('gray');
  });
});

describe('SupervisorPanel — per-project collapsible group', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }) as any));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders a collapsible project header with the claudepix avatar and a combined-state attribute', () => {
    render(<SupervisorPanel />);
    const header = screen.getByTestId('supervisor-project-header');
    expect(header.getAttribute('data-project')).toBe('/proj');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    // The combined status is one of the known palette values.
    expect(['permission', 'active', 'waiting', 'unknown']).toContain(header.getAttribute('data-combined-status'));
    // The dancing-Claude avatar renders in the header.
    expect(screen.getByTestId('claudepix')).toBeTruthy();
    // Both supervised sessions render under the (expanded) group.
    expect(screen.getAllByTestId('session-card')).toHaveLength(2);
  });
});
