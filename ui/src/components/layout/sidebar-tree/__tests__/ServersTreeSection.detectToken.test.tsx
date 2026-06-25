/**
 * Detect reuses an existing token instead of minting a fresh one.
 *
 * The server treats its config.json MERMAID_AUTH_TOKEN as authoritative and
 * ignores a new env token, so re-running Detect (which used to always mint a
 * fresh token) desynced the app from the server and 401'd every authed call.
 * Detect now passes the token already baked into the saved start command so the
 * suggested command keeps the same, server-accepted token.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ServerInfo } from '@/contexts/ServerContext';

// jsdom here doesn't provide localStorage; the component reads it for launch
// prefills, so back it with a minimal in-memory store.
const _ls: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in _ls ? _ls[k] : null),
  setItem: (k: string, v: string) => { _ls[k] = String(v); },
  removeItem: (k: string) => { delete _ls[k]; },
  clear: () => { for (const k of Object.keys(_ls)) delete _ls[k]; },
};

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

vi.mock('@/components/ServerIcon', () => ({ ServerIcon: () => <span data-testid="server-icon" /> }));

import { ServersTreeSection } from '../ServersTreeSection';

const EXISTING = 'abc123def456';

function mkServer(over: Partial<ServerInfo>): ServerInfo {
  return { id: 'vd', label: 'virtualdev', host: 'virtualdev', port: 9002, status: 'offline', source: 'manual', pairing: 'paired', ...over };
}

describe('ServersTreeSection Detect token reuse', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the token from the saved start command to /api/server/detect', async () => {
    // A prior launch saved a command with the server's token baked in.
    localStorage.setItem(
      'mc-launch-prefill:virtualdev:9002',
      JSON.stringify({ user: 'jlp', command: `MERMAID_AUTH_TOKEN=${EXISTING} MERMAID_BIND_HOST=0.0.0.0 mermaid-collab start --port 9002` }),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, suggestedCommand: `MERMAID_AUTH_TOKEN=${EXISTING} ... --port 9002`, token: EXISTING }),
    } as Response);

    serversFixture = [mkServer({})];
    render(<ServersTreeSection />);

    fireEvent.click(screen.getByLabelText('Launch server virtualdev')); // open launch form (prefilled)
    fireEvent.click(screen.getByText('Detect'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/server/detect');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ host: 'virtualdev', port: 9002, token: EXISTING });
  });

  it('omits the token on first detect (default command has none → server mints fresh)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, suggestedCommand: 'MERMAID_AUTH_TOKEN=new MERMAID_BIND_HOST=0.0.0.0 ... --port 9002', token: 'new' }),
    } as Response);

    serversFixture = [mkServer({})];
    render(<ServersTreeSection />);

    fireEvent.click(screen.getByLabelText('Launch server virtualdev'));
    fireEvent.click(screen.getByText('Detect'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).token).toBeUndefined();
  });
});
