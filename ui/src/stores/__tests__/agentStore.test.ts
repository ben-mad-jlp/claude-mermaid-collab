import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from '../agentStore';
import type { AgentEvent } from '../../types/agent';

const base = { sessionId: 's1', ts: 0 };

beforeEach(() => {
  useAgentStore.getState().reset();
});

describe('agentStore.applyEvent', () => {
  it('session_started sets ready + claudeSessionId + cwd + resumed', () => {
    useAgentStore.getState().applyEvent({
      ...base,
      kind: 'session_started',
      claudeSessionId: 'cs-1',
      cwd: '/tmp',
      resumed: false,
    } as AgentEvent);
    const s = useAgentStore.getState();
    expect(s.ready).toBe(true);
    expect(s.claudeSessionId).toBe('cs-1');
    expect(s.cwd).toBe('/tmp');
    expect(s.resumed).toBe(false);
  });

  it('user_message appends; duplicate id no-ops', () => {
    const ev: AgentEvent = { ...base, kind: 'user_message', messageId: 'u1', text: 'hi' };
    useAgentStore.getState().applyEvent(ev);
    useAgentStore.getState().applyEvent(ev);
    expect(useAgentStore.getState().messages().length).toBe(1);
    expect(useAgentStore.getState().messages()[0].role).toBe('user');
    expect(useAgentStore.getState().messages()[0].text).toBe('hi');
  });

  it('turn_start sets currentTurnId', () => {
    useAgentStore.getState().applyEvent({ ...base, kind: 'turn_start', turnId: 't1' } as AgentEvent);
    expect(useAgentStore.getState().currentTurnId).toBe('t1');
  });

  it('in-order assistant_delta concatenates text', () => {
    const s = useAgentStore.getState();
    ['Hel', 'lo', '!'].forEach((text, i) =>
      s.applyEvent({
        ...base,
        kind: 'assistant_delta',
        turnId: 't1',
        messageId: 'a1',
        index: i,
        text,
      } as AgentEvent),
    );
    const msg = useAgentStore.getState().messages().find((m) => m.id === 'a1');
    expect(msg?.text).toBe('Hello!');
    expect(useAgentStore.getState().streamingMessageId).toBe('a1');
  });

  it('out-of-order assistant_delta buffers then flushes', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'assistant_delta', turnId: 't', messageId: 'a', index: 2, text: 'C' } as AgentEvent);
    s.applyEvent({ ...base, kind: 'assistant_delta', turnId: 't', messageId: 'a', index: 0, text: 'A' } as AgentEvent);
    s.applyEvent({ ...base, kind: 'assistant_delta', turnId: 't', messageId: 'a', index: 1, text: 'B' } as AgentEvent);
    expect(useAgentStore.getState().messages().find((m) => m.id === 'a')?.text).toBe('ABC');
  });

  it('assistant_message_complete (historical) on fresh id inserts historical message', () => {
    const s = useAgentStore.getState();
    s.applyEvent({
      ...base,
      kind: 'assistant_message_complete',
      turnId: 't',
      messageId: 'a',
      text: 'final',
      historical: true,
    } as AgentEvent);
    const msg = useAgentStore.getState().messages().find((m) => m.id === 'a');
    expect(msg?.text).toBe('final');
    expect(msg?.historical).toBe(true);
  });

  it('live assistant_message_complete replaces text when no prior live message exists', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'assistant_delta', turnId: 't', messageId: 'a', index: 0, text: 'partial' } as AgentEvent);
    s.applyEvent({
      ...base,
      kind: 'assistant_message_complete',
      turnId: 't',
      messageId: 'a',
      text: 'final',
      historical: false,
    } as AgentEvent);
    const msg = useAgentStore.getState().messages().find((m) => m.id === 'a');
    expect(msg?.text).toBe('final');
    expect(msg?.historical).toBe(false);
  });

  it('historical assistant_message_complete after live one is ignored (backfill replay)', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'assistant_delta', turnId: 't', messageId: 'a', index: 0, text: 'streamed' } as AgentEvent);
    s.applyEvent({
      ...base,
      kind: 'assistant_message_complete',
      turnId: 't',
      messageId: 'a',
      text: 'real final',
      historical: false,
    } as AgentEvent);
    // Later, backfill after respawn replays the same messageId as historical.
    s.applyEvent({
      ...base,
      kind: 'assistant_message_complete',
      turnId: 'hist-turn-0',
      messageId: 'a',
      text: 'stale historical text',
      historical: true,
    } as AgentEvent);
    const msg = useAgentStore.getState().messages().find((m) => m.id === 'a');
    expect(msg?.text).toBe('real final');
    expect(msg?.historical).toBe(false);
    expect(useAgentStore.getState().messages().filter((m) => m.id === 'a').length).toBe(1);
  });

  it('live assistant_message_complete after historical one replaces it', () => {
    const s = useAgentStore.getState();
    s.applyEvent({
      ...base,
      kind: 'assistant_message_complete',
      turnId: 'hist-turn-0',
      messageId: 'a',
      text: 'historical',
      historical: true,
    } as AgentEvent);
    s.applyEvent({
      ...base,
      kind: 'assistant_message_complete',
      turnId: 't',
      messageId: 'a',
      text: 'live',
      historical: false,
    } as AgentEvent);
    const msg = useAgentStore.getState().messages().find((m) => m.id === 'a');
    expect(msg?.text).toBe('live');
    expect(msg?.historical).toBe(false);
  });

  it('turn_start with hist- turnId does not mutate currentTurnId', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'turn_start', turnId: 't-live' } as AgentEvent);
    expect(useAgentStore.getState().currentTurnId).toBe('t-live');
    s.applyEvent({ ...base, kind: 'turn_start', turnId: 'hist-turn-3' } as AgentEvent);
    expect(useAgentStore.getState().currentTurnId).toBe('t-live');
  });

  it('turn_end with hist- turnId does not clear streaming state', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'turn_start', turnId: 't-live' } as AgentEvent);
    s.applyEvent({ ...base, kind: 'assistant_delta', turnId: 't-live', messageId: 'm1', index: 0, text: 'x' } as AgentEvent);
    expect(useAgentStore.getState().streamingMessageId).toBe('m1');
    s.applyEvent({ ...base, kind: 'turn_end', turnId: 'hist-turn-0', stopReason: 'end_turn' } as AgentEvent);
    expect(useAgentStore.getState().currentTurnId).toBe('t-live');
    expect(useAgentStore.getState().streamingMessageId).toBe('m1');
  });

  it('turn_end clears streamingMessageId and stores usage', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'turn_start', turnId: 't' } as AgentEvent);
    s.applyEvent({ ...base, kind: 'assistant_delta', turnId: 't', messageId: 'a', index: 0, text: 'x' } as AgentEvent);
    s.applyEvent({
      ...base,
      kind: 'turn_end',
      turnId: 't',
      usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
      stopReason: 'end_turn',
    } as AgentEvent);
    expect(useAgentStore.getState().streamingMessageId).toBeNull();
    expect(useAgentStore.getState().usage).toEqual({ inputTokens: 10, outputTokens: 20, costUsd: 0.01 });
    expect(useAgentStore.getState().currentTurnId).toBeNull();
  });

  it('turn_end with canceled=true clears in-flight state (bug #8)', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'turn_start', turnId: 't-c' } as AgentEvent);
    s.applyEvent({ ...base, kind: 'assistant_delta', turnId: 't-c', messageId: 'a-c', index: 0, text: 'partial' } as AgentEvent);
    expect(useAgentStore.getState().streamingMessageId).toBe('a-c');
    expect(useAgentStore.getState().currentTurnId).toBe('t-c');
    s.applyEvent({
      ...base,
      kind: 'turn_end',
      turnId: 't-c',
      canceled: true,
      stopReason: 'canceled',
    } as AgentEvent);
    expect(useAgentStore.getState().streamingMessageId).toBeNull();
    expect(useAgentStore.getState().currentTurnId).toBeNull();
  });

  it('error event sets lastError', () => {
    useAgentStore.getState().applyEvent({
      ...base,
      kind: 'error',
      where: 'child',
      message: 'boom',
      recoverable: true,
    } as AgentEvent);
    expect(useAgentStore.getState().lastError).toBe('boom');
  });

  it('unknown kind logs warning and does not mutate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = useAgentStore.getState().messages();
    useAgentStore.getState().applyEvent({ ...base, kind: 'bogus' as any } as any);
    expect(useAgentStore.getState().messages()).toEqual(before);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('send() appends user message locally', () => {
    useAgentStore.getState().send('hello');
    const msgs = useAgentStore.getState().messages();
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].text).toBe('hello');
  });
});
