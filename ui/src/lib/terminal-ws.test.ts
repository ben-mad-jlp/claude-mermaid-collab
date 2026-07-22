import { describe, it, expect, afterEach } from 'vitest';
import { getTerminalWebSocketURL, makeSwitchMessage } from './terminal-ws';
import { useTerminalStore } from '@/stores/terminalStore';

describe('getTerminalWebSocketURL', () => {
  it('derives a per-server ws:// URL from the document origin (rides the proxy)', () => {
    const url = getTerminalWebSocketURL('srv1', 'my-session');
    expect(url).toBe(`ws://${window.location.host}/_per-server/srv1/terminal/my-session`);
  });

  it('encodes the server id and session id', () => {
    expect(getTerminalWebSocketURL('a/b', 'c d')).toContain('/_per-server/a%2Fb/terminal/c%20d');
  });
});

describe('makeSwitchMessage', () => {
  it('builds a switch message carrying the (serverId, sessionId) target', () => {
    expect(makeSwitchMessage('srv-2', 'mc-repo-lane')).toEqual({
      type: 'switch',
      serverId: 'srv-2',
      sessionId: 'mc-repo-lane',
    });
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
