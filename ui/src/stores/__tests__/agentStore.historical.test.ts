import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';
import type { AgentMessage } from '../agentStore';
import type { AgentEvent } from '../../types/agent';

const base = { sessionId: 's1', ts: 0 };

beforeEach(() => {
  useAgentStore.getState().reset();
});

describe('agentStore historical + seq tracking', () => {
  it('applyEvent with { historical: true } flags resulting message as historical', () => {
    const ev = {
      ...base,
      kind: 'user_message',
      messageId: 'u1',
      text: 'hello',
    } as unknown as AgentEvent;
    useAgentStore.getState().applyEvent(ev, { historical: true });
    const msgs = useAgentStore.getState().messages() as AgentMessage[];
    expect(msgs.length).toBe(1);
    expect(msgs[0].historical).toBe(true);
  });

  it('applyEvent advances lastSeenSeq monotonically; older seq ignored', () => {
    const mk = (seq: number, messageId: string): AgentEvent =>
      ({
        ...base,
        kind: 'user_message',
        messageId,
        text: messageId,
        seq,
      }) as unknown as AgentEvent;

    useAgentStore.getState().applyEvent(mk(5, 'u1'));
    expect(useAgentStore.getState().lastSeenSeq).toBe(5);

    // Older seq should NOT pull lastSeenSeq backwards.
    useAgentStore.getState().applyEvent(mk(3, 'u2'));
    expect(useAgentStore.getState().lastSeenSeq).toBe(5);

    // Newer seq advances it.
    useAgentStore.getState().applyEvent(mk(10, 'u3'));
    expect(useAgentStore.getState().lastSeenSeq).toBe(10);
  });

  it('updateLastSeenSeq only advances forward', () => {
    const s = useAgentStore.getState();
    s.updateLastSeenSeq(7);
    expect(useAgentStore.getState().lastSeenSeq).toBe(7);
    s.updateLastSeenSeq(4);
    expect(useAgentStore.getState().lastSeenSeq).toBe(7);
    s.updateLastSeenSeq(8);
    expect(useAgentStore.getState().lastSeenSeq).toBe(8);
  });

  it('setHistoricalDone flips the flag', () => {
    expect(useAgentStore.getState().historicalDone).toBe(false);
    useAgentStore.getState().setHistoricalDone(true);
    expect(useAgentStore.getState().historicalDone).toBe(true);
    useAgentStore.getState().setHistoricalDone(false);
    expect(useAgentStore.getState().historicalDone).toBe(false);
  });
});
