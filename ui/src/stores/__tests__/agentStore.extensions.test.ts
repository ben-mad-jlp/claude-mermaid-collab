import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';

beforeEach(() => {
  useAgentStore.getState().reset();
});

describe('agentStore extensions', () => {
  it('thinkingBlocks: appendThinking accumulates and setThinking overwrites', () => {
    const s = useAgentStore.getState();
    s.appendThinking('t1', 'hello');
    s.appendThinking('t1', ' world');
    expect(useAgentStore.getState().thinkingBlocks.t1).toBe('hello world');
    useAgentStore.getState().setThinking('t1', 'final');
    expect(useAgentStore.getState().thinkingBlocks.t1).toBe('final');
  });

  it('nestedTimelines: addNested is idempotent', () => {
    const s = useAgentStore.getState();
    s.addNested('p1', 'c1');
    s.addNested('p1', 'c2');
    s.addNested('p1', 'c1');
    expect(useAgentStore.getState().nestedTimelines.p1).toEqual(['c1', 'c2']);
  });

  it('trustedTools: set and revoke', () => {
    const s = useAgentStore.getState();
    s.setTrustedTools(['Read', 'Edit']);
    expect(useAgentStore.getState().trustedTools).toEqual(['Read', 'Edit']);
    useAgentStore.getState().revokeTrusted('Read');
    expect(useAgentStore.getState().trustedTools).toEqual(['Edit']);
  });

  it('multiSession: add, setActive, removeSession clears active when match', () => {
    const s = useAgentStore.getState();
    s.addSession('s1', 'Alpha');
    s.addSession('s2', 'Beta');
    useAgentStore.getState().addSession('s1', 'Dup');
    expect(useAgentStore.getState().multiSession.sessions.s1.name).toBe('Alpha');
    useAgentStore.getState().setActive('s1');
    expect(useAgentStore.getState().multiSession.activeSessionId).toBe('s1');
    useAgentStore.getState().removeSession('s1');
    const ms = useAgentStore.getState().multiSession;
    expect(ms.activeSessionId).toBeNull();
    expect(ms.sessions.s1).toBeUndefined();
    expect(ms.sessions.s2).toBeTruthy();
  });

  it('userMessageHistory: ring buffer caps at 50', () => {
    const s = useAgentStore.getState();
    for (let i = 0; i < 55; i++) s.pushUserMessage('m' + i);
    const hist = useAgentStore.getState().userMessageHistory;
    expect(hist.length).toBe(50);
    expect(hist[0]).toBe('m5');
    expect(hist[49]).toBe('m54');
    expect(useAgentStore.getState().recallUserMessage(0)).toBe('m5');
  });

  it('prStatus: set, overwrite, clear', () => {
    const s = useAgentStore.getState();
    s.setPRStatus('s1', { number: 42, url: 'u' });
    expect(useAgentStore.getState().prStatus.s1.number).toBe(42);
    useAgentStore.getState().setPRStatus('s1', { number: 42, url: 'u', checks: 'pass' });
    expect(useAgentStore.getState().prStatus.s1.checks).toBe('pass');
    useAgentStore.getState().clearPRStatus('s1');
    expect(useAgentStore.getState().prStatus.s1).toBeUndefined();
  });

  it('attachments: add and remove by id', () => {
    const s = useAgentStore.getState();
    s.addAttachment('s1', { attachmentId: 'a1', mimeType: 'image/png', url: 'u1', sizeBytes: 10 });
    s.addAttachment('s1', { attachmentId: 'a2', mimeType: 'image/png', url: 'u2', sizeBytes: 20 });
    expect(useAgentStore.getState().attachments.s1.length).toBe(2);
    useAgentStore.getState().removeAttachment('s1', 'a1');
    expect(useAgentStore.getState().attachments.s1.length).toBe(1);
    expect(useAgentStore.getState().attachments.s1[0].attachmentId).toBe('a2');
  });
});
