import { describe, it, expect } from 'vitest';
import type {
  AgentEvent,
  AssistantThinkingEvent,
  CompactionEvent,
  ModelChangeEvent,
  AttachmentUploadedEvent,
} from '../contracts';

describe('contracts: new AgentEvent variants', () => {
  it('AssistantThinkingEvent narrows via kind', () => {
    const ev: AssistantThinkingEvent = {
      kind: 'assistant_thinking',
      sessionId: 's1',
      ts: 1,
      turnId: 't1',
      text: 'thinking...',
      delta: true,
    };
    const wide: AgentEvent = ev;
    if (wide.kind === 'assistant_thinking') {
      expect(wide.text).toBe('thinking...');
      expect(wide.turnId).toBe('t1');
    } else throw new Error('expected assistant_thinking');
  });

  it('CompactionEvent narrows via kind', () => {
    const ev: CompactionEvent = {
      kind: 'compaction',
      sessionId: 's1',
      ts: 2,
      tokensBefore: 10000,
      tokensAfter: 4000,
      messagesRetained: 12,
    };
    const wide: AgentEvent = ev;
    if (wide.kind === 'compaction') {
      expect(wide.tokensBefore).toBe(10000);
      expect(wide.messagesRetained).toBe(12);
    } else throw new Error('expected compaction');
  });

  it('ModelChangeEvent narrows via kind', () => {
    const ev: ModelChangeEvent = {
      kind: 'model_change',
      sessionId: 's1',
      ts: 3,
      turnId: 't2',
      model: 'claude-opus-4-7',
    };
    const wide: AgentEvent = ev;
    if (wide.kind === 'model_change') {
      expect(wide.model).toBe('claude-opus-4-7');
    } else throw new Error('expected model_change');
  });

  it('AttachmentUploadedEvent narrows via kind', () => {
    const ev: AttachmentUploadedEvent = {
      kind: 'attachment_uploaded',
      sessionId: 's1',
      ts: 4,
      attachmentId: 'a1',
      mimeType: 'image/png',
      url: 'https://example.com/a1.png',
      sizeBytes: 2048,
    };
    const wide: AgentEvent = ev;
    if (wide.kind === 'attachment_uploaded') {
      expect(wide.attachmentId).toBe('a1');
      expect(wide.sizeBytes).toBe(2048);
    } else throw new Error('expected attachment_uploaded');
  });
});
