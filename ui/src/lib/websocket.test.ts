import { describe, it, expect, afterEach } from 'vitest';
import { getWebSocketClient, resetWebSocketClient } from './websocket';

// The server-switcher relies on resetWebSocketClient() fully replacing the
// singleton so the next getWebSocketClient() rebuilds against the current
// (proxy) origin. These tests pin that lifecycle. (No connect() is called, so
// the global WebSocket is never constructed.)
describe('WebSocket singleton lifecycle', () => {
  afterEach(() => resetWebSocketClient());

  it('returns the same instance on repeated calls', () => {
    const a = getWebSocketClient('ws://127.0.0.1:9999/ws');
    const b = getWebSocketClient('ws://127.0.0.1:9999/ws');
    expect(a).toBe(b);
    expect(a.clientId).toBe(b.clientId);
  });

  it('rebuilds a fresh instance after resetWebSocketClient()', () => {
    const before = getWebSocketClient('ws://127.0.0.1:9999/ws');
    resetWebSocketClient();
    const after = getWebSocketClient('ws://127.0.0.1:9999/ws');
    expect(after).not.toBe(before);
    expect(after.clientId).not.toBe(before.clientId);
  });
});
