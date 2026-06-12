/**
 * [P4b] Pair/Unpair controls in the Servers tree section.
 *
 * Verifies the pairing-state rendering logic:
 * - a `pending` server shows a Pending badge + a Pair action
 * - a `paired` non-local server shows an Unpair action (no Pair)
 * - the desktop's own local (auto-paired) server shows neither Pair nor Unpair
 * and that clicking Pair/Unpair calls the corresponding bridge method.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ServerInfo } from '@/contexts/ServerContext';

const pairServer = vi.fn(async () => {});
const unpairServer = vi.fn(async () => {});

let serversFixture: ServerInfo[] = [];

vi.mock('@/contexts/ServerContext', () => ({
  useServers: () => ({
    available: true,
    servers: serversFixture,
    refresh: vi.fn(),
    recheckServer: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    pairServer,
    unpairServer,
    setServerToken: vi.fn(),
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

describe('[P4b] ServersTreeSection pairing controls', () => {
  beforeEach(() => {
    pairServer.mockClear();
    unpairServer.mockClear();
  });

  it('a pending server shows a Pending badge and a Pair action (no Unpair)', () => {
    serversFixture = [mkServer({ id: 'p1', label: 'pending-srv', source: 'local', pairing: 'pending' })];
    render(<ServersTreeSection />);
    expect(screen.getByTestId('server-pending-badge-p1')).toBeInTheDocument();
    expect(screen.getByLabelText('Pair pending-srv')).toBeInTheDocument();
    expect(screen.queryByLabelText('Unpair pending-srv')).toBeNull();
  });

  it('a paired non-local server shows Unpair (no Pair, no badge)', () => {
    serversFixture = [mkServer({ id: 'm1', label: 'manual-srv', source: 'manual', pairing: 'paired' })];
    render(<ServersTreeSection />);
    expect(screen.queryByTestId('server-pending-badge-m1')).toBeNull();
    expect(screen.queryByLabelText('Pair manual-srv')).toBeNull();
    expect(screen.getByLabelText('Unpair manual-srv')).toBeInTheDocument();
  });

  it('the local auto-paired home server hides Unpair', () => {
    serversFixture = [mkServer({ id: 'l1', label: 'home', source: 'local', pairing: 'paired' })];
    render(<ServersTreeSection />);
    expect(screen.queryByLabelText('Unpair home')).toBeNull();
    expect(screen.queryByLabelText('Pair home')).toBeNull();
  });

  it('clicking Pair / Unpair invokes the bridge', () => {
    serversFixture = [mkServer({ id: 'p1', label: 'pending-srv', source: 'local', pairing: 'pending' })];
    const { rerender } = render(<ServersTreeSection />);
    fireEvent.click(screen.getByLabelText('Pair pending-srv'));
    expect(pairServer).toHaveBeenCalledWith('p1');

    serversFixture = [mkServer({ id: 'm1', label: 'manual-srv', source: 'manual', pairing: 'paired' })];
    rerender(<ServersTreeSection />);
    fireEvent.click(screen.getByLabelText('Unpair manual-srv'));
    expect(unpairServer).toHaveBeenCalledWith('m1');
  });
});
