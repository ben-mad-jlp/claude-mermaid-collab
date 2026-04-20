import { describe, it, expect } from 'bun:test';
import { projectFrame } from '../projector.ts';
import type { AgentEvent, ProjectionCtx } from '../contracts.ts';

function freshCtx(historical = false): ProjectionCtx {
  return {
    sessionId: 's1',
    currentTurnId: null,
    currentAssistantMessageId: null,
    nextDeltaIndex: 0,
    historical,
    seenToolUseIds: new Set<string>(),
    completedToolUseIds: new Set<string>(),
    toolInputDeltas: {},
  };
}

// Normalize volatile fields (ts + generated ids) to stable placeholders.
// Preserves ids that look like fixture-provided (start with 'msg_' or 'turn_').
function normalize(events: AgentEvent[]): any[] {
  const idMap = new Map<string, string>();
  let counter = 0;
  const remap = (id: string | undefined): string | undefined => {
    if (id == null) return id;
    if (id.startsWith('msg_') || id.startsWith('turn_') || id.startsWith('sess-')) return id;
    if (!idMap.has(id)) {
      idMap.set(id, `<id:${counter++}>`);
    }
    return idMap.get(id)!;
  };
  return events.map(e => {
    const clone: any = { ...e, ts: 0 };
    if ('turnId' in clone) clone.turnId = remap(clone.turnId);
    if ('messageId' in clone) clone.messageId = remap(clone.messageId);
    return clone;
  });
}

function runFixture(frames: any[], ctx = freshCtx()): any[] {
  const out: AgentEvent[] = [];
  for (const f of frames) out.push(...projectFrame(f, ctx));
  return normalize(out);
}

describe('projectFrame tool-call projection', () => {
  it('read-happy: emits turn_start → tool_call_started → assistant_message_complete → tool_call_completed → turn_end', () => {
    const frames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: '/tmp/a' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents', is_error: false }],
        },
      },
      { type: 'result', stop_reason: 'end_turn' },
    ];
    const out = runFixture(frames);
    const kinds = out.map(e => e.kind);
    expect(kinds).toEqual([
      'turn_start',
      'tool_call_started',
      'assistant_message_complete',
      'tool_call_completed',
      'turn_end',
    ]);
    const started = out[1] as any;
    expect(started.name).toBe('Read');
    expect(started.toolUseId).toBe('tu_1');
    expect(started.historical).toBe(false);
    const completed = out[3] as any;
    expect(completed.toolUseId).toBe('tu_1');
    expect(completed.status).toBe('ok');
  });

  it('bash-nonzero-exit: tool_result.is_error true yields status: error on completed event', () => {
    const frames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'false' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'exit 1', is_error: true }],
        },
      },
      { type: 'result', stop_reason: 'end_turn' },
    ];
    const out = runFixture(frames);
    const kinds = out.map(e => e.kind);
    expect(kinds).toEqual([
      'turn_start',
      'tool_call_started',
      'assistant_message_complete',
      'tool_call_completed',
      'turn_end',
    ]);
    const completed = out.find(e => e.kind === 'tool_call_completed') as any;
    expect(completed.status).toBe('error');
    expect(completed.toolUseId).toBe('tu_1');
  });

  it('early-start dedup: stream_event tool_use then assistant tool_use emits only ONE tool_call_started', () => {
    const frames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} },
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: '/x' } }],
        },
      },
    ];
    const out = runFixture(frames);
    const started = out.filter(e => e.kind === 'tool_call_started');
    expect(started.length).toBe(1);
    expect((started[0] as any).toolUseId).toBe('tu_1');
  });

  it('backfill-duplicate (historical): same frames twice yields zero events second time; both events historical:true', () => {
    const ctx = freshCtx(true);
    const frames = [
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: '/x' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false }],
        },
      },
    ];
    const firstRaw: AgentEvent[] = [];
    for (const f of frames) firstRaw.push(...projectFrame(f, ctx));
    const first = normalize(firstRaw);
    const started = first.find(e => e.kind === 'tool_call_started') as any;
    const completed = first.find(e => e.kind === 'tool_call_completed') as any;
    expect(started.historical).toBe(true);
    expect(completed.historical).toBe(true);

    const secondRaw: AgentEvent[] = [];
    for (const f of frames) secondRaw.push(...projectFrame(f, ctx));
    const second = normalize(secondRaw);
    const replayStarted = second.filter(e => e.kind === 'tool_call_started');
    const replayCompleted = second.filter(e => e.kind === 'tool_call_completed');
    expect(replayStarted.length).toBe(0);
    expect(replayCompleted.length).toBe(0);
  });
});
