import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

/**
 * Regression test for the "supervised card shows the fallback/alien server icon"
 * bug. Supervised rows are stamped with the 'local' SENTINEL (serverScope =
 * activeId ?? 'local'), but serverIconById was built only from servers[].id —
 * which are real uuids/paths — so get('local') missed and the card fell back to
 * the generic icon. The fix registers the 'local' sentinel against the local
 * server's icon. Here we render the panel with a supervised row carrying
 * serverId='local' and assert the SessionCard receives the local server's icon
 * name ('Rocket'), not undefined.
 */

const LOCAL_ICON = 'Rocket';

// Capture the serverIcon prop SessionCard is rendered with.
vi.mock('@/components/layout/SessionCard', () => ({
  SessionCard: ({ serverIcon }: { serverIcon?: string }) => (
    <div data-testid="session-card" data-server-icon={serverIcon ?? ''} />
  ),
  ClaudePixAvatar: ({ status }: { status: string }) => (
    <div data-testid="claudepix" data-status={status} />
  ),
  activateSessionCard: vi.fn(),
}));

// Avoid pulling the onboarding subtree (only rendered when not 'running').
vi.mock('@/components/supervisor/SupervisorOnboarding', () => ({
  SupervisorOnboarding: () => <div data-testid="onboarding" />,
}));

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: () => ({
    supervised: [{ project: '/proj', session: 'sess-a', serverId: 'local' }],
    escalations: [],
    config: { supervisorProject: '/proj', supervisorSession: 'sup' },
    liveness: { running: true },
    loadSupervised: vi.fn(),
    loadEscalations: vi.fn(),
    loadConfig: vi.fn(),
    loadLiveness: vi.fn(),
    resolveEscalation: vi.fn(),
  }),
}));

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

// The local server carries a real id (uuid-like) — NOT 'local' — plus source:'local'.
vi.mock('@/contexts/ServerContext', () => ({
  useServers: () => ({
    servers: [
      { id: 'srv-uuid-123', label: 'Local', host: 'localhost', port: 9002, status: 'online', source: 'local', icon: LOCAL_ICON },
    ],
  }),
}));

import { SupervisorPanel } from '../SupervisorPanel';

describe('SupervisorPanel — local sentinel icon resolution', () => {
  beforeEach(() => {
    // The status-poll effect uses fetch; stub it so the effect doesn't throw.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }) as any));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders a supervised row stamped with serverId="local" using the local server icon, not the fallback', () => {
    render(<SupervisorPanel />);

    const card = screen.getByTestId('session-card');
    // Before the fix this would be '' (undefined → generic fallback icon).
    expect(card.getAttribute('data-server-icon')).toBe(LOCAL_ICON);
  });
});
