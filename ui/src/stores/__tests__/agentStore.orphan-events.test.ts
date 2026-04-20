import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';
import type {
  SessionClearedEvent,
  CompactionEvent,
  AssistantThinkingEvent,
  ModelChangeEvent,
  UserMessageEvent,
  AssistantMessageCompleteEvent,
  PermissionRequestedEvent,
  UserInputRequestedEvent,
} from '@/types/agent';

beforeEach(() => {
  useAgentStore.getState().reset();
});

describe('agentStore orphan-events wiring', () => {
  it('session_cleared resets streaming/pending state but preserves completed messages', () => {
    const s = useAgentStore.getState();
    // seed a user message + streaming message + thinking + model + pending input + permission
    const user: UserMessageEvent = {
      kind: 'user_message', sessionId: 'x', ts: 1, messageId: 'u1', text: 'hi',
    };
    const complete: AssistantMessageCompleteEvent = {
      kind: 'assistant_message_complete', sessionId: 'x', ts: 2,
      turnId: 't1', messageId: 'a1', text: 'hello',
    };
    const thinking: AssistantThinkingEvent = {
      kind: 'assistant_thinking', sessionId: 'x', ts: 3, turnId: 't1', text: 'think',
    };
    const model: ModelChangeEvent = {
      kind: 'model_change', sessionId: 'x', ts: 4, turnId: 't1', model: 'claude-opus-4',
    };
    const perm: PermissionRequestedEvent = {
      kind: 'permission_requested', sessionId: 'x', ts: 5,
      promptId: 'p1', toolUseId: 'tu1', turnId: 't1', name: 'Bash', input: {}, deadlineMs: 99999,
    };
    const userInput: UserInputRequestedEvent = {
      kind: 'user_input_requested', sessionId: 'x', ts: 6, promptId: 'q1',
      prompt: '?', expectedKind: 'text', deadlineMs: 99999,
    };
    s.applyEvent(user);
    s.applyEvent(complete);
    s.applyEvent(thinking);
    s.applyEvent(model);
    s.applyEvent(perm);
    s.applyEvent(userInput);
    // simulate in-flight streaming
    useAgentStore.setState({ streamingMessageId: 'a1', currentTurnId: 't1' });

    const cleared: SessionClearedEvent = {
      kind: 'session_cleared', sessionId: 'x', ts: 10,
    };
    useAgentStore.getState().applyEvent(cleared);
    const after = useAgentStore.getState();
    // Completed messages preserved
    const msgs = after.timeline.filter((t) => t.type === 'message');
    expect(msgs.length).toBe(2);
    // Per-session stale state reset
    expect(after.currentTurnId).toBeNull();
    expect(after.streamingMessageId).toBeNull();
    expect(after.thinkingByTurn).toEqual({});
    expect(after.thinkingBlocks).toEqual({});
    expect(after.modelByTurn).toEqual({});
    expect(after.compactions).toEqual([]);
    expect(after.pendingUserInputs).toEqual({});
    expect(after.pendingPromptCount).toBe(0);
  });

  it('compaction appends to compactions list with afterTimelineId anchor', () => {
    const s = useAgentStore.getState();
    // seed a user message so there is an anchor
    s.applyEvent({
      kind: 'user_message', sessionId: 'x', ts: 1, messageId: 'u1', text: 'hi',
    } as UserMessageEvent);
    const c1: CompactionEvent = {
      kind: 'compaction', sessionId: 'x', ts: 2,
      tokensBefore: 1000, tokensAfter: 300, messagesRetained: 5,
    };
    s.applyEvent(c1);
    const state = useAgentStore.getState();
    expect(state.compactions.length).toBe(1);
    expect(state.compactions[0].afterTimelineId).toBe('u1');
    expect(state.compactions[0].tokensBefore).toBe(1000);
    // leading (no messages yet)
    useAgentStore.getState().reset();
    useAgentStore.getState().applyEvent(c1);
    expect(useAgentStore.getState().compactions[0].afterTimelineId).toBeNull();
  });

  it('assistant_thinking replace vs delta', () => {
    const s = useAgentStore.getState();
    s.applyEvent({
      kind: 'assistant_thinking', sessionId: 'x', ts: 1, turnId: 't1', text: 'hello',
    } as AssistantThinkingEvent);
    expect(useAgentStore.getState().thinkingByTurn.t1).toBe('hello');
    useAgentStore.getState().applyEvent({
      kind: 'assistant_thinking', sessionId: 'x', ts: 2, turnId: 't1', text: ' world', delta: true,
    } as AssistantThinkingEvent);
    expect(useAgentStore.getState().thinkingByTurn.t1).toBe('hello world');
    // replace (no delta)
    useAgentStore.getState().applyEvent({
      kind: 'assistant_thinking', sessionId: 'x', ts: 3, turnId: 't1', text: 'final',
    } as AssistantThinkingEvent);
    expect(useAgentStore.getState().thinkingByTurn.t1).toBe('final');
  });

  it('model_change records modelByTurn', () => {
    const s = useAgentStore.getState();
    s.applyEvent({
      kind: 'model_change', sessionId: 'x', ts: 1, turnId: 't1', model: 'claude-opus-4-7',
    } as ModelChangeEvent);
    expect(useAgentStore.getState().modelByTurn.t1).toBe('claude-opus-4-7');
    useAgentStore.getState().applyEvent({
      kind: 'model_change', sessionId: 'x', ts: 2, turnId: 't1', model: 'claude-haiku',
    } as ModelChangeEvent);
    expect(useAgentStore.getState().modelByTurn.t1).toBe('claude-haiku');
  });
});
