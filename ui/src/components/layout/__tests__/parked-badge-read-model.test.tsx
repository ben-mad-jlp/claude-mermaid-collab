import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

/**
 * parked-badge-read-model.test.tsx — the badge renders only when claimable > 0,
 * not when ready > 0. The divergence: ready = claimable ∪ human-assignee,
 * claimable = agent-only todos. This test pins that the badge counts claimable,
 * and is absent when only human-assignee ready todos exist.
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
import { projectPlanStats } from '../SupervisorPanel';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: null,
    title: p.id,
    description: null,
    status: 'planned',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    approvedAt: '2026-06-16T00:00:00Z',
    heldAt: null,
    claim: null,
    acceptanceStatus: null,
    assigneeKind: null,
    claimedBy: null,
    kind: 'leaf',
    ...p,
  } as SessionTodo;
}

describe('SupervisorPanel — parked badge read-model', () => {
  beforeEach(() => {
    const fetchMock = vi.fn((url: string) => {
      // Stub the missions API for both projects
      if (typeof url === 'string' && url.includes('/api/supervisor/missions')) {
        if (url.includes('project=%2Fproj-a')) {
          // /proj-a has no active mission
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ missions: [] }),
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

  it('the parked badge is absent when the claimability read-model reports zero claimable', async () => {
    // Fixture: 2 approved dep-free leaves with assigneeKind:'human', none in flight.
    // These are "ready" (human-assignee) but NOT "claimable".
    const humanReady1 = todo({
      id: 'leaf-human-1',
      parentId: 'epic-1',
      assigneeKind: 'human',
      approvedAt: '2026-06-16T00:00:00Z',
      dependsOn: [],
    });
    const humanReady2 = todo({
      id: 'leaf-human-2',
      parentId: 'epic-1',
      assigneeKind: 'human',
      approvedAt: '2026-06-16T00:00:00Z',
      dependsOn: [],
    });
    const epicTodo = todo({ id: 'epic-1', kind: 'epic', parentId: null });

    const fixture = [epicTodo, humanReady1, humanReady2];

    // Verify that the fixture exercises the ready-vs-claimable divergence:
    // ready > 0 (includes human-assignee) but claimable === 0 (agent-only)
    const stats = projectPlanStats(fixture);
    expect(stats.ready).toBeGreaterThan(0);
    expect(stats.claimable).toBe(0);
    expect(stats.inProgress).toBe(0);

    // Inject fixture into the mock store
    const { useSupervisorStore } = await import('@/stores/supervisorStore');
    useSupervisorStore.getState().todosByProject = { '/proj-a': fixture };

    render(<SupervisorPanel />);

    // Wait for render and locate the header for /proj-a
    await waitFor(
      () => {
        const headers = screen.getAllByTestId('supervisor-project-header');
        const projAHeader = headers.find((h) => h.getAttribute('data-project') === '/proj-a');
        expect(projAHeader).toBeTruthy();

        // Assert badge is absent
        const badge = projAHeader?.querySelector('[data-testid="supervisor-project-parked"]');
        expect(badge).toBeFalsy();
      },
      { timeout: 3000 },
    );
  });

  it('the parked badge names the claimable count from the read-model', async () => {
    // Fixture: 2 assigneeKind:'agent' claimable leaves + 3 assigneeKind:'human' ready leaves
    const agentClaimable1 = todo({
      id: 'leaf-agent-1',
      parentId: 'epic-1',
      assigneeKind: 'agent',
      approvedAt: '2026-06-16T00:00:00Z',
      dependsOn: [],
    });
    const agentClaimable2 = todo({
      id: 'leaf-agent-2',
      parentId: 'epic-1',
      assigneeKind: 'agent',
      approvedAt: '2026-06-16T00:00:00Z',
      dependsOn: [],
    });
    const humanReady1 = todo({
      id: 'leaf-human-1',
      parentId: 'epic-1',
      assigneeKind: 'human',
      approvedAt: '2026-06-16T00:00:00Z',
      dependsOn: [],
    });
    const humanReady2 = todo({
      id: 'leaf-human-2',
      parentId: 'epic-1',
      assigneeKind: 'human',
      approvedAt: '2026-06-16T00:00:00Z',
      dependsOn: [],
    });
    const humanReady3 = todo({
      id: 'leaf-human-3',
      parentId: 'epic-1',
      assigneeKind: 'human',
      approvedAt: '2026-06-16T00:00:00Z',
      dependsOn: [],
    });
    const epicTodo = todo({ id: 'epic-1', kind: 'epic', parentId: null });

    const fixture = [
      epicTodo,
      agentClaimable1,
      agentClaimable2,
      humanReady1,
      humanReady2,
      humanReady3,
    ];

    // Verify the fixture setup: claimable (agent-only) differs from ready (agent + human)
    const stats = projectPlanStats(fixture);
    expect(stats.claimable).toBe(2);
    expect(stats.ready).toBe(5); // 2 agent + 3 human
    expect(stats.inProgress).toBe(0);

    // Inject fixture into the mock store
    const { useSupervisorStore } = await import('@/stores/supervisorStore');
    useSupervisorStore.getState().todosByProject = { '/proj-a': fixture };

    render(<SupervisorPanel />);

    // Wait for render and locate the header for /proj-a
    await waitFor(
      () => {
        const headers = screen.getAllByTestId('supervisor-project-header');
        const projAHeader = headers.find((h) => h.getAttribute('data-project') === '/proj-a');
        expect(projAHeader).toBeTruthy();

        // Assert badge exists and names the claimable count
        const badge = projAHeader?.querySelector('[data-testid="supervisor-project-parked"]');
        expect(badge).toBeTruthy();
        expect(badge?.textContent).toContain(String(stats.claimable));

        // Assert the badge does NOT contain the ready count (since claimable ≠ ready)
        expect(badge?.textContent).not.toContain(String(stats.ready));
      },
      { timeout: 3000 },
    );
  });
});
