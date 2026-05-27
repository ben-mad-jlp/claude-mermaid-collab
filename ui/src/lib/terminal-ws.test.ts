import { describe, it, expect, afterEach } from 'vitest';
import { getTerminalWebSocketURL } from './terminal-ws';
import { useTerminalStore } from '@/stores/terminalStore';

describe('getTerminalWebSocketURL', () => {
  it('derives a ws:// URL from the document origin (rides the proxy)', () => {
    // jsdom default location is http://localhost:3000
    const url = getTerminalWebSocketURL('my-session');
    expect(url).toBe(`ws://${window.location.host}/terminal/my-session`);
  });

  it('encodes the session id', () => {
    expect(getTerminalWebSocketURL('a/b session')).toContain('/terminal/a%2Fb%20session');
  });
});

describe('terminalStore', () => {
  afterEach(() => useTerminalStore.setState({ open: false }));

  it('toggles open state', () => {
    expect(useTerminalStore.getState().open).toBe(false);
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().open).toBe(true);
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().open).toBe(false);
  });
});
