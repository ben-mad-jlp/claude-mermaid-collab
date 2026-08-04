import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
      { project: '/proj', session: 'sess-stale', serverId: 'other-server', stale: true },
    ],
    escalations: [],
    watchedProjects: [{ project: '/proj' }],
    todosByProject: {},
    loadProjectTodos: vi.fn(),
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
  };
  const useSupervisorStore = (sel?: (s: any) => any) => (sel ? sel(state) : state);
  useSupervisorStore.getState = () => state;
  return { useSupervisorStore };
});

vi.mock('@/stores/subscriptionStore', () => {
  // Live subscriptions so both sessions resolve to a colored (non-gray) status —
  // the per-project list hides gray (unknown) worker lanes, so a statusless
  // session would be filtered out and the render assertion below would see 0 cards.
  // A stable object (like the real memoized store) so effects keyed on it don't
  // re-fire every render.
  const state = {
    subscriptions: {
      'local|/proj|sess-a': { serverId: 'local', project: '/proj', session: 'sess-a', status: 'waiting', lastUpdate: Date.now() },
      'local|/proj|sess-b': { serverId: 'local', project: '/proj', session: 'sess-b', status: 'active', lastUpdate: Date.now() },
    },
  };
  return { useSubscriptionStore: (sel: (s: any) => any) => sel(state) };
});

vi.mock('@/stores/sessionStore', () => {
  const state = { currentSession: null, sessions: [], setCurrentSession: vi.fn() };
  return { useSessionStore: (sel: (s: any) => any) => sel(state) };
});

vi.mock('@/contexts/ServerContext', () => {
  // Stable array reference (the real ServerContext memoizes its value) so the
  // effect keyed on `servers` doesn't re-fire every render.
  const value = {
    servers: [
      { id: 'srv-uuid-123', label: 'Local', host: 'localhost', port: 9002, status: 'online', source: 'local', icon: 'Rocket' },
    ],
  };
  return { useServers: () => value };
});

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

  it('renders a project header with the claudepix avatar and the combined-state attribute', () => {
    // The panel is a header-only per-project index — the per-project chevron and
    // inline session cards were dropped (fde3ced8). The header still carries the
    // combined per-project health (reduced from its sessions) + the dancing avatar.
    render(<SupervisorPanel />);
    const header = screen.getByTestId('supervisor-project-header');
    expect(header.getAttribute('data-project')).toBe('/proj');
    // Combined status reduces the two sessions (waiting + active) → 'active' (AMBER):
    // active wins over waiting, and nothing needs permission.
    expect(header.getAttribute('data-combined-status')).toBe('active');
    // The dancing-Claude avatar renders in the header.
    expect(screen.getByTestId('claudepix')).toBeTruthy();
  });

  it('turns the project card RED when its conductor is in a "— needs you" state', async () => {
    // A settled "capped — needs you" conductor pass raises no counted escalation
    // (the serve-cap card can be resolved-then-silenced), so the ONLY signal is the
    // conductor-running route's `attention` list. The card must still go red rather
    // than sit green next to a needs-you status. Sessions are waiting+active (no build
    // running), so the red human signal wins over the combined-session amber.
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(
          typeof url === 'string' && url.includes('/api/supervisor/conductor-running')
            ? { projects: [], ownedTodoIds: {}, attention: ['/proj'] }
            : {},
        ),
      }) as any,
    ));
    render(<SupervisorPanel />);
    // resolveDaemonStatus maps a red human signal (nothing building) → 'permission'.
    await waitFor(() => {
      expect(screen.getByTestId('claudepix').getAttribute('data-status')).toBe('permission');
    });
  });

  it('renders a retained stale session\'s row indicator and marks it stale without counting it as live', () => {
    // The mock now includes a third stale session with no matching subscription
    // (sess-stale from 'other-server'), so it resolves to status: 'unknown' and is
    // filtered out of the visible count but marked as stale in a separate badge.
    render(<SupervisorPanel />);
    const header = screen.getByTestId('supervisor-project-header');
    // The stale badge exists and is marked with data-stale="true".
    const staleBadge = screen.getByTestId('supervisor-project-stale');
    expect(staleBadge).toBeTruthy();
    expect(staleBadge.getAttribute('data-stale')).toBe('true');
    // The live count remains 2 (sess-a + sess-b), excluding the stale session.
    expect(screen.getByText('2λ')).toBeTruthy();
  });
});
