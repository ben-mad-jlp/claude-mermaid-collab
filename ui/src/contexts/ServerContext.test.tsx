import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ServerProvider, useServer } from './ServerContext';

const resetMock = vi.fn();
vi.mock('@/lib/websocket', () => ({
  resetWebSocketClient: () => resetMock(),
}));

function Probe() {
  const { available, servers, activeId, switchServer } = useServer();
  return (
    <div>
      <span data-testid="available">{String(available)}</span>
      <span data-testid="count">{servers.length}</span>
      <span data-testid="active">{activeId ?? 'none'}</span>
      <button onClick={() => switchServer('s2')}>switch</button>
    </div>
  );
}

describe('ServerContext', () => {
  beforeEach(() => {
    resetMock.mockClear();
    delete (window as unknown as { mc?: unknown }).mc;
  });
  afterEach(() => {
    delete (window as unknown as { mc?: unknown }).mc;
  });

  it('is a no-op pass-through when window.mc is absent (browser tab)', async () => {
    render(
      <ServerProvider>
        <Probe />
      </ServerProvider>
    );
    expect(screen.getByTestId('available').textContent).toBe('false');
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
  });

  it('lists servers and switching repoints + resets WS + updates active', async () => {
    const switchServer = vi.fn(async () => ({ ok: true }));
    (window as unknown as { mc: unknown }).mc = {
      listServers: vi.fn(async () => [
        { id: 's1', label: 'This Mac', host: '127.0.0.1', port: 9002, status: 'online', source: 'local' },
        { id: 's2', label: 'box', host: '10.0.0.5', port: 9002, status: 'offline', source: 'manual' },
      ]),
      getActiveServer: vi.fn(async () => 's1'),
      switchServer,
      addServer: vi.fn(),
      removeServer: vi.fn(),
    };

    render(
      <ServerProvider>
        <Probe />
      </ServerProvider>
    );

    await waitFor(() => expect(screen.getByTestId('available').textContent).toBe('true'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    expect(screen.getByTestId('active').textContent).toBe('s1');

    await act(async () => {
      screen.getByText('switch').click();
    });

    expect(switchServer).toHaveBeenCalledWith('s2');
    expect(resetMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('s2'));
  });
});
