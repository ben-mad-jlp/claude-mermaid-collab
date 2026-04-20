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

describe('projectFrame', () => {
  it('fx01 hi-short: init → stream deltas → assistant final → result', () => {
    const frames = [
      { type: 'system', subtype: 'init', session_id: 'sess-1', cwd: '/tmp' },
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '!' } } },
      { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'hi!' }] } },
      { type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 }, total_cost_usd: 0.0001 },
    ];
    const out = runFixture(frames);
    expect(out).toEqual([
      { kind: 'session_started', sessionId: 's1', ts: 0, claudeSessionId: 'sess-1', cwd: '/tmp', resumed: false },
      { kind: 'turn_start', sessionId: 's1', ts: 0, turnId: '<id:0>' },
      { kind: 'assistant_delta', sessionId: 's1', ts: 0, turnId: '<id:0>', messageId: 'msg_1', index: 0, text: 'hi' },
      { kind: 'assistant_delta', sessionId: 's1', ts: 0, turnId: '<id:0>', messageId: 'msg_1', index: 1, text: '!' },
      { kind: 'assistant_message_complete', sessionId: 's1', ts: 0, turnId: '<id:0>', messageId: 'msg_1', text: 'hi!', historical: false },
      { kind: 'turn_end', sessionId: 's1', ts: 0, turnId: '<id:0>', usage: { inputTokens: 3, outputTokens: 2, costUsd: 0.0001 }, stopReason: 'end_turn' },
    ]);
  });

  it('fx02 multi-sentence streamed: many deltas have monotonic index', () => {
    const parts = ['Hello', ' ', 'world', '.', ' How', ' are', ' you', '?'];
    const frames: any[] = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
      ...parts.map(p => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: p } } })),
      { type: 'result', stop_reason: 'end_turn' },
    ];
    const out = runFixture(frames);
    const deltas = out.filter(e => e.kind === 'assistant_delta');
    expect(deltas.map((d: any) => d.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(deltas.map((d: any) => d.text).join('')).toBe('Hello world. How are you?');
  });

  it('fx03 multi-message turn: each message_start emits new turn_start and resets index', () => {
    const frames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } },
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_2' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } } },
      { type: 'result', stop_reason: 'end_turn' },
    ];
    const out = runFixture(frames);
    const starts = out.filter(e => e.kind === 'turn_start');
    expect(starts.length).toBe(2);
    // Turn ids differ
    expect((starts[0] as any).turnId).not.toBe((starts[1] as any).turnId);
    const deltas = out.filter(e => e.kind === 'assistant_delta') as any[];
    expect(deltas[0].index).toBe(0);
    expect(deltas[1].index).toBe(0); // reset after new message_start
    expect(deltas[0].messageId).toBe('msg_1');
    expect(deltas[1].messageId).toBe('msg_2');
  });

  it('fx04 abrupt end: no result → no turn_end emitted', () => {
    const frames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } },
    ];
    const out = runFixture(frames);
    expect(out.find(e => e.kind === 'turn_end')).toBeUndefined();
  });

  it('fx05 partial-only (delta before message_start): synthesizes turn_start', () => {
    const frames = [
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } },
    ];
    const out = runFixture(frames);
    expect(out[0].kind).toBe('turn_start');
    expect(out[1].kind).toBe('assistant_delta');
    expect((out[1] as any).index).toBe(0);
  });

  it('fx06 unknown frame type emits error', () => {
    const frames = [
      { type: 'system', subtype: 'init', session_id: 'sess-x', cwd: '/' },
      { type: 'bogus' },
    ];
    const out = runFixture(frames);
    expect(out[0].kind).toBe('session_started');
    expect(out[1].kind).toBe('error');
    expect((out[1] as any).where).toBe('parse');
  });

  // TODO: rewrite for Phase 2 tool-call projection
  it.skip('fx07 tool_use blocks are dropped', () => {
    const frames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} } } },
      { type: 'stream_event', event: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'after' } } },
      { type: 'result', stop_reason: 'end_turn' },
    ];
    const out = runFixture(frames);
    expect(out.filter(e => e.kind === 'turn_start').length).toBe(1);
    const deltas = out.filter(e => e.kind === 'assistant_delta') as any[];
    expect(deltas.length).toBe(1);
    expect(deltas[0].text).toBe('after');
    expect(deltas[0].index).toBe(0);
  });

  it('fx08 historical resume flag propagates', () => {
    const frames = [
      { type: 'system', subtype: 'init', session_id: 'sess-r', cwd: '/r' },
      { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'old' }] } },
    ];
    const ctx = freshCtx(true);
    const out: AgentEvent[] = [];
    for (const f of frames) out.push(...projectFrame(f, ctx));
    const normalized = normalize(out);
    expect((normalized[0] as any).resumed).toBe(true);
    expect((normalized[1] as any).historical).toBe(true);
  });
});
