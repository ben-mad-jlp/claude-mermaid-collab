/**
 * useAgentSession — commandId / retry buffer tests (w2a-client-commandid).
 *
 * Verifies:
 * - Every outbound command carries a non-empty string commandId.
 * - command_ack clears the matching entry from the retry buffer
 *   (proved by observing that on reconnect, acked commands are not re-sent).
 * - Reconnect re-sends any command still in the retry buffer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// --- Mock the websocket client module ---
type MsgHandler = (msg: any) => void;
type ConnectHandler = () => void;

const sendSpy = vi.fn();
const subscribeSpy = vi.fn();
const unsubscribeSpy = vi.fn();

let msgHandlers: MsgHandler[] = [];
let connectHandlers: ConnectHandler[] = [];
let connected = true;

const fakeClient = {
  isConnected: () => connected,
  send: (...args: any[]) => sendSpy(...args),
  subscribe: (...args: any[]) => subscribeSpy(...args),
  unsubscribe: (...args: any[]) => unsubscribeSpy(...args),
  onMessage: (h: MsgHandler) => {
    msgHandlers.push(h);
    return { unsubscribe: () => { msgHandlers = msgHandlers.filter((x) => x !== h); } };
  },
  onConnect: (h: ConnectHandler) => {
    connectHandlers.push(h);
    return { unsubscribe: () => { connectHandlers = connectHandlers.filter((x) => x !== h); } };
  },
};

vi.mock('../../lib/websocket', () => ({
  getWebSocketClient: () => fakeClient,
}));

// Zustand stores used by the hook — stub out heavy store internals.
vi.mock('../../stores/agentStore', () => {
  const state = {
    reset: vi.fn(),
    applyEvent: vi.fn(),
    send: vi.fn(),
    resolvePermission: vi.fn(),
    setPermissionMode: vi.fn(),
  };
  const useAgentStore: any = (sel: any) => sel(state);
  useAgentStore.getState = () => state;
  useAgentStore.setState = vi.fn();
  return { useAgentStore };
});

vi.mock('../../stores/uiStore', () => {
  const state = { agentChatVisible: true };
  const useUIStore: any = (sel: any) => sel(state);
  useUIStore.getState = () => state;
  return { useUIStore };
});

// Import after mocks so hook picks them up.
import { useAgentSession } from '../useAgentSession';

function lastSends(): any[] {
  return sendSpy.mock.calls.map((c) => c[0]);
}

describe('useAgentSession — commandId / retry buffer', () => {
  beforeEach(() => {
    sendSpy.mockClear();
    subscribeSpy.mockClear();
    unsubscribeSpy.mockClear();
    msgHandlers = [];
    connectHandlers = [];
    connected = true;
  });

  it('attaches a non-empty string commandId to every outbound command', () => {
    const { result } = renderHook(() => useAgentSession('sess-1'));

    // Mount already sent agent_resume.
    act(() => {
      result.current.send('hello');
      result.current.cancel('turn-x');
      result.current.setPermissionMode('accept-edits');
      result.current.resolvePermission('p1', 'allow_once');
      result.current.commitPushPR({ title: 'feat: x' });
    });

    const sends = lastSends();
    expect(sends.length).toBeGreaterThanOrEqual(6); // resume + 5 above

    for (const s of sends) {
      expect(typeof s.commandId).toBe('string');
      expect(s.commandId.length).toBeGreaterThan(0);
      expect(typeof s.type).toBe('string');
    }

    // All commandIds should be unique.
    const ids = sends.map((s) => s.commandId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('command_ack clears the buffer entry (not re-sent on reconnect)', () => {
    const { result } = renderHook(() => useAgentSession('sess-ack'));

    act(() => {
      result.current.send('first');
    });

    const sendMsg = lastSends().find((s) => s.type === 'agent_send');
    expect(sendMsg).toBeDefined();
    const ackedId = sendMsg.commandId;

    // Deliver command_ack for that command.
    act(() => {
      for (const h of msgHandlers) {
        h({
          type: 'agent_event',
          event: {
            kind: 'command_ack',
            sessionId: 'sess-ack',
            commandId: ackedId,
            ts: Date.now(),
          },
        });
      }
    });

    sendSpy.mockClear();

    // Trigger reconnect — acked command should NOT be re-sent.
    act(() => {
      for (const h of connectHandlers) h();
    });

    const resent = lastSends();
    const resentSendCmds = resent.filter((s) => s.type === 'agent_send');
    expect(resentSendCmds.find((s) => s.commandId === ackedId)).toBeUndefined();
  });

  it('re-sends buffered (unacked) commands on reconnect', () => {
    const { result } = renderHook(() => useAgentSession('sess-reconn'));

    act(() => {
      result.current.send('buffered-msg');
    });

    const original = lastSends().find((s) => s.type === 'agent_send');
    expect(original).toBeDefined();
    const cmdId = original.commandId;

    sendSpy.mockClear();

    // Fire reconnect — no ack was received, so this command should be re-sent.
    act(() => {
      for (const h of connectHandlers) h();
    });

    const resent = lastSends();
    const match = resent.find((s) => s.type === 'agent_send' && s.commandId === cmdId);
    expect(match).toBeDefined();
    expect(match.text).toBe('buffered-msg');
  });
});
