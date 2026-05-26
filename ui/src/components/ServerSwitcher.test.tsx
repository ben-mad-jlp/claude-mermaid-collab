import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ServerProvider } from '@/contexts/ServerContext';
import { ServerSwitcher } from './ServerSwitcher';

vi.mock('@/lib/websocket', () => ({ resetWebSocketClient: vi.fn() }));

function setMc() {
  const switchServer = vi.fn(async () => ({ ok: true }));
  (window as unknown as { mc: unknown }).mc = {
    listServers: vi.fn(async () => [
      { id: 's1', label: 'This Mac', host: '127.0.0.1', port: 9002, status: 'online', source: 'local' },
      { id: 's2', label: 'box', host: '10.0.0.5', port: 9002, status: 'offline', source: 'manual' },
    ]),
    getActiveServer: vi.fn(async () => 's1'),
    switchServer,
    addServer: vi.fn(async () => 's3'),
    removeServer: vi.fn(),
  };
  return { switchServer };
}

const renderSwitcher = () =>
  render(
    <ServerProvider>
      <ServerSwitcher />
    </ServerProvider>
  );

describe('ServerSwitcher', () => {
  beforeEach(() => delete (window as unknown as { mc?: unknown }).mc);
  afterEach(() => delete (window as unknown as { mc?: unknown }).mc);

  it('renders nothing without window.mc (browser tab)', () => {
    const { container } = renderSwitcher();
    expect(container.querySelector('.server-switcher')).toBeNull();
  });

  it('shows the active server and lists servers on open', async () => {
    setMc();
    renderSwitcher();
    await waitFor(() => expect(screen.getByText('This Mac')).toBeTruthy());
    await act(async () => { screen.getByText('This Mac').click(); });
    expect(screen.getByText('box')).toBeTruthy();
    expect(screen.getByText('10.0.0.5:9002')).toBeTruthy();
  });

  it('switches when a server is clicked', async () => {
    const { switchServer } = setMc();
    renderSwitcher();
    await waitFor(() => expect(screen.getByText('This Mac')).toBeTruthy());
    await act(async () => { screen.getByText('This Mac').click(); }); // open menu
    await act(async () => { screen.getByText('box').click(); }); // pick box
    expect(switchServer).toHaveBeenCalledWith('s2');
  });
});
