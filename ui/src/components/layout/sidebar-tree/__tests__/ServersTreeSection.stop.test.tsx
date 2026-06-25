/**
 * Stop control in the Servers tree section.
 *
 * Verifies the stop-server rendering + behavior:
 * - a reachable (online) non-local server shows a Stop action
 * - an offline server shows Launch, not Stop
 * - the desktop's own local home server never shows Stop (stopping it would
 *   kill the app's own backend)
 * - clicking Stop confirms first, and only calls the bridge when confirmed
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ServerInfo } from '@/contexts/ServerContext';

const stopServer = vi.fn(async () => {});

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
    stopServer,
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
    host: '127.0.0.1',
    port: 9002,
    status: 'online',
    source: 'manual',
    pairing: 'paired',
    ...over,
  };
}

describe('ServersTreeSection stop control', () => {
  beforeEach(() => {
    stopServer.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an online non-local server shows a Stop action (and no Launch)', () => {
    serversFixture = [mkServer({ id: 'm1', label: 'remote', source: 'manual', status: 'online' })];
    render(<ServersTreeSection />);
    expect(screen.getByLabelText('Stop server remote')).toBeInTheDocument();
    expect(screen.queryByLabelText('Launch server remote')).toBeNull();
  });

  it('an offline server shows Launch, not Stop', () => {
    serversFixture = [mkServer({ id: 'm1', label: 'remote', source: 'manual', status: 'offline' })];
    render(<ServersTreeSection />);
    expect(screen.queryByLabelText('Stop server remote')).toBeNull();
    expect(screen.getByLabelText('Launch server remote')).toBeInTheDocument();
  });

  it('the local home server never shows Stop', () => {
    serversFixture = [mkServer({ id: 'l1', label: 'home', source: 'local', status: 'online' })];
    render(<ServersTreeSection />);
    expect(screen.queryByLabelText('Stop server home')).toBeNull();
  });

  it('clicking Stop calls the bridge only when confirmed', () => {
    serversFixture = [mkServer({ id: 'm1', label: 'remote', source: 'manual', host: 'virtualdev', port: 9002 })];
    render(<ServersTreeSection />);

    // Decline the confirm → no call.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByLabelText('Stop server remote'));
    expect(stopServer).not.toHaveBeenCalled();

    // Accept the confirm → bridge invoked with the server id.
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByLabelText('Stop server remote'));
    expect(stopServer).toHaveBeenCalledWith('m1');
  });
});
