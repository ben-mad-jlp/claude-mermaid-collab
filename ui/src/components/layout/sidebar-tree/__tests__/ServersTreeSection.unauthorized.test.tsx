/**
 * Servers tree: the 'unauthorized' status (reachable but the saved token was
 * rejected with 401). Regression guard for the auth-failure-visibility fix —
 * a token mismatch must NOT read as a healthy/online server.
 *
 * - an 'unauthorized' server shows the Auth badge
 * - an 'online' server shows no Auth badge
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ServerInfo } from '@/contexts/ServerContext';

let serversFixture: ServerInfo[] = [];

vi.mock('@/contexts/ServerContext', () => ({
  useServers: () => ({
    available: true,
    servers: serversFixture,
    refresh: vi.fn(),
    recheckServer: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    pairServer: vi.fn(),
    unpairServer: vi.fn(),
    setServerToken: vi.fn(),
    stopServer: vi.fn(),
  }),
}));

// ServerIcon pulls in lucide; stub it to keep the render light and deterministic.
vi.mock('@/components/ServerIcon', () => ({
  ServerIcon: () => <span data-testid="server-icon" />,
}));

import { ServersTreeSection } from '../ServersTreeSection';

function mkServer(over: Partial<ServerInfo>): ServerInfo {
  return {
    id: 'id',
    label: 'srv',
    host: 'virtualdev',
    port: 9002,
    status: 'online',
    source: 'manual',
    pairing: 'paired',
    ...over,
  };
}

describe('ServersTreeSection unauthorized status', () => {
  it('an unauthorized server shows the Auth badge', () => {
    serversFixture = [mkServer({ id: 'u1', label: 'virtualdev', status: 'unauthorized' })];
    render(<ServersTreeSection />);
    const badge = screen.getByTestId('server-unauthorized-badge-u1');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Auth');
  });

  it('an online server shows no Auth badge', () => {
    serversFixture = [mkServer({ id: 'o1', label: 'virtualdev', status: 'online' })];
    render(<ServersTreeSection />);
    expect(screen.queryByTestId('server-unauthorized-badge-o1')).toBeNull();
  });
});
