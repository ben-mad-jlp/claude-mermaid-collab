import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

/**
 * Crit met/total indicator on the project card — wired from the active mission's
 * capability rollup. Shows only when an active mission exists with capability progress.
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
      { project: '/proj-a', session: 'sess-a', serverId: 'local' },
      { project: '/proj-b', session: 'sess-b', serverId: 'local' },
    ],
    escalations: [],
    openEscalations: [],
    watchedProjects: [{ project: '/proj-a' }, { project: '/proj-b' }],
    todosByProject: {},
    loadProjectTodos: vi.fn(),
    config: { supervisorProject: '/proj-a', supervisorSession: 'sup' },
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
  const state = {
    subscriptions: {
      'local|/proj-a|sess-a': {
        serverId: 'local',
        project: '/proj-a',
        session: 'sess-a',
        status: 'waiting',
        lastUpdate: Date.now(),
      },
      'local|/proj-b|sess-b': {
        serverId: 'local',
        project: '/proj-b',
        session: 'sess-b',
        status: 'waiting',
        lastUpdate: Date.now(),
      },
    },
  };
  return { useSubscriptionStore: (sel: (s: any) => any) => sel(state) };
});

vi.mock('@/stores/sessionStore', () => {
  const state = { currentSession: null, sessions: [], setCurrentSession: vi.fn() };
  return { useSessionStore: (sel: (s: any) => any) => sel(state) };
});

vi.mock('@/contexts/ServerContext', () => {
  const value = {
    servers: [
      {
        id: 'srv-uuid-123',
        label: 'Local',
        host: 'localhost',
        port: 9002,
        status: 'online',
        source: 'local',
        icon: 'Rocket',
      },
    ],
  };
  return { useServers: () => value };
});

import { SupervisorPanel } from '../SupervisorPanel';

describe('SupervisorPanel — crit met/total indicator', () => {
  beforeEach(() => {
    const fetchMock = vi.fn((url: string) => {
      // Stub the missions API for both projects
      if (typeof url === 'string' && url.includes('/api/supervisor/missions')) {
        if (url.includes('project=%2Fproj-a')) {
          // /proj-a has an active mission with met: 2, total: 8
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                missions: [
                  {
                    node: { id: 'mission-1', title: '[mission] Alpha', status: 'converged' },
                    mission: { active: true, phase: 'converged' },
                    rollup: { capability: { met: 2, total: 8 } },
                  },
                ],
              }),
          }) as any;
        } else if (url.includes('project=%2Fproj-b')) {
          // /proj-b has no active mission
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ missions: [] }),
          }) as any;
        }
      }
      // All other endpoints — stub as no-op
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) }) as any;
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows crit met/total for a project with an active mission and hides it for a project without one', async () => {
    render(<SupervisorPanel />);

    // Wait for the fetch-driven state update to resolve. The hook calls fetch
    // immediately on mount, so we should see the crit chip appear.
    await waitFor(
      () => {
        // /proj-a has an active mission, so it should show the crit chip
        const headers = screen.getAllByTestId('supervisor-project-header');
        const projAHeader = headers.find((h) => h.getAttribute('data-project') === '/proj-a');
        expect(projAHeader).toBeTruthy();

        const critChip = projAHeader?.querySelector('[data-testid="supervisor-project-crit"]');
        expect(critChip).toBeTruthy();
        expect(critChip?.textContent).toBe('crit 2/8');
      },
      { timeout: 3000 },
    );

    // /proj-b does NOT have an active mission, so it should NOT show the crit chip
    const headers = screen.getAllByTestId('supervisor-project-header');
    expect(headers.length).toBeGreaterThanOrEqual(2);

    // Find the header for /proj-b by checking its data-project attribute
    const projBHeader = headers.find((h) => h.getAttribute('data-project') === '/proj-b');
    expect(projBHeader).toBeTruthy();

    // Verify no crit chip in the /proj-b header
    const projBCritChip = projBHeader?.querySelector('[data-testid="supervisor-project-crit"]');
    expect(projBCritChip).toBeFalsy();
  });
});
