import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';
import type { AgentEvent } from '../../types/agent';

const base = { sessionId: 's1', ts: 1000 };

beforeEach(() => {
  useAgentStore.getState().reset();
});

describe('agentStore.applyEvent — permission_*', () => {
  it('permission_requested pushes pending item and increments pendingPromptCount', () => {
    useAgentStore.getState().applyEvent({
      ...base, kind: 'permission_requested',
      promptId: 'p1', name: 'Bash', deadlineMs: 5000,
    } as AgentEvent);
    const { timeline, pendingPromptCount } = useAgentStore.getState();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: 'permission', id: 'p1', status: 'pending',
    });
    expect(pendingPromptCount).toBe(1);
  });

  it('permission_requested dedups by promptId', () => {
    const s = useAgentStore.getState();
    const ev = {
      ...base, kind: 'permission_requested',
      promptId: 'p1', name: 'Bash', deadlineMs: 5000,
    } as AgentEvent;
    s.applyEvent(ev);
    s.applyEvent(ev);
    expect(useAgentStore.getState().timeline).toHaveLength(1);
    expect(useAgentStore.getState().pendingPromptCount).toBe(1);
  });

  it('permission_resolved allow_session transitions status to allowed', () => {
    const s = useAgentStore.getState();
    s.applyEvent({
      ...base, kind: 'permission_requested',
      promptId: 'p1', name: 'Bash', deadlineMs: 5000,
    } as AgentEvent);
    s.applyEvent({
      ...base, ts: 2000, kind: 'permission_resolved',
      promptId: 'p1', decision: 'allow_session', resolvedBy: 'user',
    } as AgentEvent);
    const item = useAgentStore.getState().timeline.find((t) => t.type === 'permission' && t.id === 'p1') as any;
    expect(item.status).toBe('allowed');
    expect(item.decision).toBe('allow_session');
    expect(item.resolvedBy).toBe('user');
    expect(useAgentStore.getState().pendingPromptCount).toBe(0);
  });

  it('permission_resolved deny transitions status to denied', () => {
    const s = useAgentStore.getState();
    s.applyEvent({
      ...base, kind: 'permission_requested',
      promptId: 'p1', name: 'Bash', deadlineMs: 5000,
    } as AgentEvent);
    s.applyEvent({
      ...base, ts: 2000, kind: 'permission_resolved',
      promptId: 'p1', decision: 'deny', resolvedBy: 'user',
    } as AgentEvent);
    const item = useAgentStore.getState().timeline.find((t) => t.type === 'permission' && t.id === 'p1') as any;
    expect(item.status).toBe('denied');
    expect(item.decision).toBe('deny');
    expect(useAgentStore.getState().pendingPromptCount).toBe(0);
  });

  it('permission_resolved timeout transitions status to timeout', () => {
    const s = useAgentStore.getState();
    s.applyEvent({
      ...base, kind: 'permission_requested',
      promptId: 'p1', name: 'Bash', deadlineMs: 5000,
    } as AgentEvent);
    s.applyEvent({
      ...base, ts: 2000, kind: 'permission_resolved',
      promptId: 'p1', resolvedBy: 'timeout',
    } as AgentEvent);
    const item = useAgentStore.getState().timeline.find((t) => t.type === 'permission' && t.id === 'p1') as any;
    expect(item.status).toBe('timeout');
    expect(item.decision).toBeUndefined();
    expect(item.resolvedBy).toBe('timeout');
    expect(useAgentStore.getState().pendingPromptCount).toBe(0);
  });

  it('setPermissionMode updates permissionMode', () => {
    expect(useAgentStore.getState().permissionMode).toBe('supervised');
    useAgentStore.getState().setPermissionMode('s1', 'accept-edits');
    expect(useAgentStore.getState().permissionMode).toBe('accept-edits');
  });
});
