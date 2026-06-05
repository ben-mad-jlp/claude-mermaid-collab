/**
 * TerminalPane robustness tests.
 *
 * Repro for the bug where a terminal whose WebSocket fails/closes before it
 * establishes (no tmux to attach to, orphaned pane after a server restart,
 * transient 1006 close) threw an UNCAUGHT xterm TypeError
 * ("Cannot read properties of undefined (reading 'dimensions')") that crashed
 * the pane. A failed/closed terminal must degrade to a 'disconnected' state,
 * not throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TerminalPane } from './TerminalPane';

// xterm needs a real renderer/canvas which jsdom lacks; stub it. The stub
// records calls so we can assert we never drive a disposed/unopened terminal.
const xtermInstances: Array<{ disposed: boolean; opened: boolean }> = [];
vi.mock('@xterm/xterm', () => {
  class Terminal {
    element: HTMLElement | null = null;
    cols = 80;
    rows = 24;
    _rec = { disposed: false, opened: false };
    constructor() {
      xtermInstances.push(this._rec);
    }
    loadAddon() {}
    open(el: HTMLElement) {
      this.element = el;
      this._rec.opened = true;
    }
    write() {}
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
  onopen: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: { wasClean: boolean; code: number; reason: string }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send() {}
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

describe('TerminalPane robustness', () => {
  it('renders without throwing', () => {
    const { container } = render(<TerminalPane sessionId="s1" serverId="local" />);
    expect(container).toBeTruthy();
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('degrades to a disconnected state (no throw) when the WS closes uncleanly before open', () => {
    render(<TerminalPane sessionId="s1" serverId="local" />);
    const ws = MockWebSocket.instances[0];

    // Simulate the failure-before-establish path: a 1006 unclean close with no
    // prior open. This previously drove xterm.syncScrollArea into an uncaught
    // TypeError.
    act(() => {
      ws.onclose?.({ wasClean: false, code: 1006, reason: '' });
    });

    expect(screen.getByTestId('terminal-disconnected')).toBeTruthy();
    // The error boundary must NOT have tripped — this is a graceful degrade.
    expect(screen.queryByTestId('terminal-error')).toBeNull();
  });

  it('degrades to a disconnected state on WS error', () => {
    render(<TerminalPane sessionId="s1" serverId="local" />);
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onerror?.(new Event('error'));
    });

    expect(screen.getByTestId('terminal-disconnected')).toBeTruthy();
  });

  it('does not show the disconnected overlay on a clean close', () => {
    render(<TerminalPane sessionId="s1" serverId="local" />);
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onclose?.({ wasClean: true, code: 1000, reason: '' });
    });

    expect(screen.queryByTestId('terminal-disconnected')).toBeNull();
  });

  it('disposes xterm on unmount', () => {
    const { unmount } = render(<TerminalPane sessionId="s1" serverId="local" />);
    expect(xtermInstances.length).toBe(1);
    unmount();
    expect(xtermInstances[0].disposed).toBe(true);
  });
});
