import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';
import type { AgentEvent } from '../../types/agent';

const base = { sessionId: 's1', ts: 1000 };

beforeEach(() => {
  useAgentStore.getState().reset();
});

describe('agentStore.applyEvent — tool_call_*', () => {
  it('tool_call_started pushes a running tool_call item onto timeline', () => {
    useAgentStore.getState().applyEvent({
      ...base, kind: 'tool_call_started',
      turnId: 't1', messageId: 'm1', toolUseId: 'tu1',
      name: 'Bash', input: { command: 'ls' }, index: 0,
    } as AgentEvent);
    const { timeline } = useAgentStore.getState();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: 'tool_call', id: 'tu1', name: 'Bash', status: 'running', progress: [],
    });
    expect(useAgentStore.getState().isStreaming()).toBe(true);
  });

  it('tool_call_progress inserts chunks sorted by seq', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'tool_call_started', turnId: 't', messageId: 'm', toolUseId: 'tu', name: 'Bash', input: {}, index: 0 } as AgentEvent);
    s.applyEvent({ ...base, kind: 'tool_call_progress', toolUseId: 'tu', channel: 'stdout', chunk: 'C', seq: 2 } as AgentEvent);
    s.applyEvent({ ...base, kind: 'tool_call_progress', toolUseId: 'tu', channel: 'stdout', chunk: 'A', seq: 0 } as AgentEvent);
    s.applyEvent({ ...base, kind: 'tool_call_progress', toolUseId: 'tu', channel: 'stdout', chunk: 'B', seq: 1 } as AgentEvent);
    const item = useAgentStore.getState().timeline.find((t) => t.type === 'tool_call' && t.id === 'tu') as any;
    expect(item.progress.map((p: any) => p.chunk)).toEqual(['A', 'B', 'C']);
  });

  it('tool_call_completed transitions status and clears streaming', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'tool_call_started', turnId: 't', messageId: 'm', toolUseId: 'tu', name: 'Bash', input: {}, index: 0 } as AgentEvent);
    s.applyEvent({ ...base, ts: 2000, kind: 'tool_call_completed', toolUseId: 'tu', status: 'ok', output: 'done' } as AgentEvent);
    const item = useAgentStore.getState().timeline.find((t) => t.type === 'tool_call' && t.id === 'tu') as any;
    expect(item.status).toBe('ok');
    expect(item.output).toBe('done');
    expect(item.endTs).toBe(2000);
    expect(useAgentStore.getState().isStreaming()).toBe(false);
  });

  it('historical tool_call_completed after live one is ignored (dedup guard)', () => {
    const s = useAgentStore.getState();
    s.applyEvent({ ...base, kind: 'tool_call_started', turnId: 't', messageId: 'm', toolUseId: 'tu', name: 'Bash', input: {}, index: 0 } as AgentEvent);
    s.applyEvent({ ...base, kind: 'tool_call_completed', toolUseId: 'tu', status: 'ok', output: 'live' } as AgentEvent);
    s.applyEvent({ ...base, kind: 'tool_call_completed', toolUseId: 'tu', status: 'error', output: 'stale', historical: true } as AgentEvent);
    const item = useAgentStore.getState().timeline.find((t) => t.type === 'tool_call' && t.id === 'tu') as any;
    expect(item.status).toBe('ok');
    expect(item.output).toBe('live');
  });

  it('sub_agent_turn adds childTurnId to nestedTimelines keyed by parentTurnId', () => {
    const s = useAgentStore.getState();
    s.applyEvent({
      ...base, kind: 'sub_agent_turn', turnId: 'child-1', parentTurnId: 'parent-1', name: 'sub',
    } as AgentEvent);
    s.applyEvent({
      ...base, kind: 'sub_agent_turn', turnId: 'child-2', parentTurnId: 'parent-1',
    } as AgentEvent);
    // dedup
    s.applyEvent({
      ...base, kind: 'sub_agent_turn', turnId: 'child-1', parentTurnId: 'parent-1',
    } as AgentEvent);
    expect(useAgentStore.getState().nestedTimelines['parent-1']).toEqual(['child-1', 'child-2']);
  });

  it('tool_call_started dedups by toolUseId', () => {
    const s = useAgentStore.getState();
    const ev = { ...base, kind: 'tool_call_started', turnId: 't', messageId: 'm', toolUseId: 'tu', name: 'Bash', input: {}, index: 0 } as AgentEvent;
    s.applyEvent(ev);
    s.applyEvent(ev);
    expect(useAgentStore.getState().timeline.filter((t) => t.type === 'tool_call').length).toBe(1);
  });
});
