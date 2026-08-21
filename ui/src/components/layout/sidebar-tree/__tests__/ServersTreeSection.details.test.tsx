/**
 * Long server identifiers must be readable.
 *
 * The sidebar row truncates label and host to fit, so a MagicDNS name like
 * trimaxion.tail445728.ts.net:9002 was cut off with no way to see it (2026-08-21).
 * The details toggle expands the full values in place, and must NOT truncate them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const LONG_HOST = 'trimaxion.tail445728.ts.net';
const SERVER = {
  id: 'srv-trimaxion',
  label: 'trimaxion',
  host: LONG_HOST,
  port: 9002,
  status: 'online',
  pairing: 'paired',
  source: 'manual',
  icon: 'server',
};

vi.mock('@/contexts/ServerContext', () => ({
  useServers: () => ({
    servers: [SERVER],
    currentServerId: SERVER.id,
    switchServer: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    pairServer: vi.fn(),
    unpairServer: vi.fn(),
    recheckServer: vi.fn(),
  }),
}));

import { ServersTreeSection } from '../ServersTreeSection';

const QR = 'mermaidcollab://pair?v=2&servers=eyJ2IjoyfQ==';

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ qr: QR, servers: [{ id: SERVER.id }] }),
  }) as never;
});

afterEach(() => vi.restoreAllMocks());

describe('ServersTreeSection details toggle', () => {
  it('shows no details panel until the toggle is pressed', () => {
    render(<ServersTreeSection />);
    expect(screen.queryByTestId(`server-details-${SERVER.id}`)).toBeNull();
  });

  it('reveals the full host and port when toggled', () => {
    render(<ServersTreeSection />);
    fireEvent.click(screen.getByTestId(`server-details-toggle-${SERVER.id}`));
    const panel = screen.getByTestId(`server-details-${SERVER.id}`);
    expect(panel.textContent).toContain(`${LONG_HOST}:9002`);
  });

  it('renders the full value without truncation', () => {
    render(<ServersTreeSection />);
    fireEvent.click(screen.getByTestId(`server-details-toggle-${SERVER.id}`));
    const dd = screen.getByTestId(`server-details-${SERVER.id}`).querySelector('dd');
    expect(dd?.className).toContain('break-all');
    expect(dd?.className).not.toContain('truncate');
  });

  it('collapses again on a second press', () => {
    render(<ServersTreeSection />);
    const btn = screen.getByTestId(`server-details-toggle-${SERVER.id}`);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByTestId(`server-details-${SERVER.id}`)).toBeNull();
  });

  it('requests a pairing code for THAT server only', async () => {
    render(<ServersTreeSection />);
    fireEvent.click(screen.getByTestId(`server-details-toggle-${SERVER.id}`));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`/api/pair?serverId=${encodeURIComponent(SERVER.id)}`);
    });
  });

  it('renders the pairing QR inside the details panel', async () => {
    render(<ServersTreeSection />);
    fireEvent.click(screen.getByTestId(`server-details-toggle-${SERVER.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`server-qr-${SERVER.id}`)).toBeTruthy();
    });
  });
});
