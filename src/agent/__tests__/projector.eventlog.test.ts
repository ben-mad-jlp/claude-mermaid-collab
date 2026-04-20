import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../event-log.js';
import { Projector } from '../projector.js';
import type { ProjectionCtx } from '../contracts.js';

function mkCtx(sessionId: string): ProjectionCtx {
  return {
    sessionId,
    currentTurnId: null,
    currentAssistantMessageId: null,
    nextDeltaIndex: 0,
    historical: false,
    seenToolUseIds: new Set(),
    completedToolUseIds: new Set(),
    toolInputDeltas: {},
    subAgentParentMap: new Map(),
    toolUseIdByBlockIndex: {},
    toolProgressSeq: {},
    thinkingDeltas: {},
    turnIdByToolUseId: {},
  };
}

describe('Projector routes events through EventLog', () => {
  let dir: string;
  let log: EventLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'projector-eventlog-'));
    log = new EventLog(join(dir, 'events.db'));
  });

  afterEach(() => {
    log.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('project() appends once per batch and returns events with monotonic seq', () => {
    const appendSpy = vi.spyOn(log, 'append');
    const projector = new Projector(log);
    const sessionId = 'sess-test';
    const ctx = mkCtx(sessionId);

    // Synthetic assistant frame with text + tool_use (produces multi-event batch).
    const assistantFrame = {
      type: 'assistant',
      message: {
        id: 'msg-1',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/a' } },
        ],
      },
    };

    // Simulate a turn_start stream_event first so currentTurnId is set.
    const msgStartFrame = {
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'msg-0' } },
    };

    const broadcast: any[] = [];
    const emit = (frame: unknown) => {
      const stamped = projector.project(frame, ctx);
      for (const ev of stamped) broadcast.push(ev);
    };

    emit(msgStartFrame); // batch 1: turn_start
    emit(assistantFrame); // batch 2: tool_call_started + assistant_message_complete
    emit({ type: 'result', stop_reason: 'end_turn' }); // batch 3: turn_end

    // append called once per non-empty batch
    expect(appendSpy).toHaveBeenCalledTimes(3);
    // Each call is for this sessionId and receives an array of events.
    for (const call of appendSpy.mock.calls) {
      expect(call[0]).toBe(sessionId);
      expect(Array.isArray(call[1])).toBe(true);
      expect((call[1] as unknown[]).length).toBeGreaterThan(0);
    }

    // All broadcast events carry numeric seq, monotonically increasing from 1.
    expect(broadcast.length).toBeGreaterThanOrEqual(4);
    const seqs = broadcast.map((e) => (e as any).seq);
    for (const s of seqs) expect(typeof s).toBe('number');
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
    expect(seqs[0]).toBe(1);
    expect(log.getLastSeq(sessionId)).toBe(seqs[seqs.length - 1]);
  });

  it('empty batch (no-op frame) does not call append', () => {
    const appendSpy = vi.spyOn(log, 'append');
    const projector = new Projector(log);
    const ctx = mkCtx('sess-empty');

    // hook_event is projected to [] (empty batch).
    const out = projector.project({ type: 'hook_event' }, ctx);
    expect(out).toEqual([]);
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('appendSynthetic routes caller-synthesized events through EventLog', () => {
    const projector = new Projector(log);
    const sessionId = 'sess-synth';
    const stamped = projector.appendSynthetic(sessionId, [
      { kind: 'session_started', sessionId, ts: 1, claudeSessionId: 'c', cwd: '/', resumed: false },
      { kind: 'session_ended', sessionId, ts: 2, reason: 'exit' },
    ]);
    expect(stamped.map((e) => (e as any).seq)).toEqual([1, 2]);
    expect(log.getLastSeq(sessionId)).toBe(2);
  });
});
