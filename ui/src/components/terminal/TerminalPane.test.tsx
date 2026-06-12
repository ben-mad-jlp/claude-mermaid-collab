/**
 * TerminalConsole robustness + re-point tests.
 *
 * The console keeps ONE WebSocket per server (to the persistent PTY) and
 * re-points it between tmux targets with `switch` messages. These tests cover:
 *   - robustness: a WS that fails/closes before it establishes must degrade to a
 *     'disconnected' state, never throw an uncaught xterm TypeError;
 *   - re-point: on open it switches to the selected tmux target, and a clean
 *     reset precedes feeding the new stream.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TerminalConsole } from './TerminalPane';

// xterm needs a real renderer/canvas which jsdom lacks; stub it. The stub
// records calls so we can assert we never drive a disposed/unopened terminal and
// that reset() runs before a re-point.
const xtermInstances: Array<{ disposed: boolean; opened: boolean; resets: number }> = [];
vi.mock('@xterm/xterm', () => {
  class Terminal {
    element: HTMLElement | null = null;
    cols = 80;
    rows = 24;
    _rec = { disposed: false, opened: false, resets: 0 };
    constructor() {
      xtermInstances.push(this._rec);
    }
    loadAddon() {}
    open(el: HTMLElement) {
      this.element = el;
      this._rec.opened = true;
    }
    write() {}
    reset() {
      this._rec.resets += 1;
    }
    onData() {
      return { dispose() {} };
    }
    dispose() {
      this._rec.disposed = true;
    }
  }
  return { Terminal };
});
vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit() {}
  }
  return { FitAddon };
});
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Controllable WebSocket mock.
class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: { wasClean: boolean; code: number; reason: string }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
}

beforeEach(() => {
  xtermInstances.length = 0;
  MockWebSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TerminalConsole robustness', () => {
  it('opens exactly one WebSocket per server to the per-client console PTY', () => {
    const { container } = render(<TerminalConsole serverId="local" tmuxBase="mc-x" />);
    expect(container).toBeTruthy();
    expect(MockWebSocket.instances.length).toBe(1);
    // jsdom provides localStorage, so the console mints a per-UI-instance id.
    expect(MockWebSocket.instances[0].url).toMatch(/\/terminal\/mc-console-/);
  });

  it('degrades to a disconnected state (no throw) when the WS closes uncleanly before open', () => {
    render(<TerminalConsole serverId="local" tmuxBase="mc-x" />);
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onclose?.({ wasClean: false, code: 1006, reason: '' });
    });

    expect(screen.getByTestId('terminal-disconnected')).toBeTruthy();
    expect(screen.queryByTestId('terminal-error')).toBeNull();
  });

  it('degrades to a disconnected state on WS error', () => {
    render(<TerminalConsole serverId="local" tmuxBase="mc-x" />);
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onerror?.(new Event('error'));
    });

    expect(screen.getByTestId('terminal-disconnected')).toBeTruthy();
  });

  it('does not show the disconnected overlay on a clean close', () => {
    render(<TerminalConsole serverId="local" tmuxBase="mc-x" />);
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onclose?.({ wasClean: true, code: 1000, reason: '' });
    });

    expect(screen.queryByTestId('terminal-disconnected')).toBeNull();
  });

  it('disposes xterm on unmount', () => {
    const { unmount } = render(<TerminalConsole serverId="local" tmuxBase="mc-x" />);
    expect(xtermInstances.length).toBe(1);
    unmount();
    expect(xtermInstances[0].disposed).toBe(true);
  });
});

describe('TerminalConsole re-point', () => {
  it('switches to the selected tmux target on open, after a clean reset', () => {
    render(<TerminalConsole serverId="srv-2" tmuxBase="mc-repo-lane" />);
    const ws = MockWebSocket.instances[0];
    ws.readyState = MockWebSocket.OPEN;

    act(() => {
      ws.onopen?.();
    });

    // A clean reset must have run, and a switch carrying the tmux base sent.
    expect(xtermInstances[0].resets).toBeGreaterThanOrEqual(1);
    const switchMsg = ws.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'switch');
    expect(switchMsg).toEqual({ type: 'switch', serverId: 'srv-2', sessionId: 'mc-repo-lane' });
  });
});
