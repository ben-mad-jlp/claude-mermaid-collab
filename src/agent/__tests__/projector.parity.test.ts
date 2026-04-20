import { test, expect, describe } from 'bun:test';
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
    subAgentParentMap: new Map<string, string>(),
    toolUseIdByBlockIndex: {},
    toolProgressSeq: {},
    thinkingDeltas: {},
    turnIdByToolUseId: {},
  };
}

function run(frames: any[], ctx: ProjectionCtx = freshCtx()): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const f of frames) out.push(...projectFrame(f, ctx));
  return out;
}

describe('projector parity (phase-2 features)', () => {
  test('feature 1: thinking block emits assistant_thinking event', () => {
    const frames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Let me consider...' },
        },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      },
      { type: 'result', stop_reason: 'end_turn' },
    ];
    const out = run(frames);
    const thinking = out.filter(e => e.kind === 'assistant_thinking') as any[];
    expect(thinking.length).toBeGreaterThanOrEqual(1);
    const combined = thinking.map(t => t.text).join('');
    expect(combined).toContain('Let me consider...');
    expect(thinking[0].turnId).toBeDefined();
  });

  test('feature 2: subagent nesting — tool calls inside a Task get parentTurnId', () => {
    const ctx = freshCtx();
    // Outer turn creates a Task tool_use (subagent)
    const outerFrames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_outer' } } },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tu_task_1',
            name: 'Task',
            input: { description: 'do stuff' },
          },
        },
      },
    ];
    const outerEvents = run(outerFrames, ctx);
    const taskStart = outerEvents.find(
      e => e.kind === 'tool_call_started' && (e as any).name === 'Task',
    ) as any;
    expect(taskStart).toBeDefined();
    const parentTurnId = taskStart.turnId;

    // The subagent then issues its own message_start + tool_use (e.g. Read)
    // These tool calls should carry parentTurnId = outer turn.
    const innerFrames = [
      {
        type: 'stream_event',
        event: {
          type: 'sub_agent_message_start',
          parent_tool_use_id: 'tu_task_1',
          message: { id: 'msg_inner' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          parent_tool_use_id: 'tu_task_1',
          content_block: {
            type: 'tool_use',
            id: 'tu_inner_read',
            name: 'Read',
            input: { file_path: '/x' },
          },
        },
      },
    ];
    const innerEvents = run(innerFrames, ctx);
    const innerTool = innerEvents.find(
      e => e.kind === 'tool_call_started' && (e as any).toolUseId === 'tu_inner_read',
    ) as any;
    // Parity check: if the projector supports subagent nesting, parentTurnId
    // should be populated and reference the outer turn that contained Task.
    expect(innerTool).toBeDefined();
    expect(innerTool.parentTurnId).toBe(parentTurnId);
  });

  test('feature 3: tool-progress stdout/stderr emit tool_call_progress with channel + seq', () => {
    const ctx = freshCtx();
    const setupFrames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_p' } } },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tu_bash_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        },
      },
    ];
    run(setupFrames, ctx);

    const progressFrames = [
      {
        type: 'tool_progress',
        tool_use_id: 'tu_bash_1',
        channel: 'stdout',
        chunk: 'file1.txt\n',
      },
      {
        type: 'tool_progress',
        tool_use_id: 'tu_bash_1',
        channel: 'stderr',
        chunk: 'warn: x\n',
      },
      {
        type: 'tool_progress',
        tool_use_id: 'tu_bash_1',
        channel: 'stdout',
        chunk: 'file2.txt\n',
      },
    ];
    const out = run(progressFrames, ctx);
    const progress = out.filter(e => e.kind === 'tool_call_progress') as any[];
    expect(progress.length).toBe(3);
    expect(progress[0].channel).toBe('stdout');
    expect(progress[0].chunk).toBe('file1.txt\n');
    expect(progress[0].toolUseId).toBe('tu_bash_1');
    expect(progress[1].channel).toBe('stderr');
    expect(progress[2].channel).toBe('stdout');
  });

  test('feature 3b: progress seq is monotonically increasing per toolUseId', () => {
    const ctx = freshCtx();
    run(
      [
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_s' } } },
        {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'tu_seq_1',
              name: 'Bash',
              input: {},
            },
          },
        },
      ],
      ctx,
    );
    const progressFrames = Array.from({ length: 5 }).map((_, i) => ({
      type: 'tool_progress',
      tool_use_id: 'tu_seq_1',
      channel: i % 2 === 0 ? 'stdout' : 'stderr',
      chunk: `chunk-${i}`,
    }));
    const out = run(progressFrames, ctx);
    const progress = out.filter(e => e.kind === 'tool_call_progress') as any[];
    expect(progress.length).toBe(5);
    const seqs = progress.map(p => p.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
    // A fresh toolUseId should restart or at least not collide with above.
    const ctx2 = freshCtx();
    run(
      [
        {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'tu_other', name: 'Bash', input: {} },
          },
        },
      ],
      ctx2,
    );
    const otherOut = run(
      [
        {
          type: 'tool_progress',
          tool_use_id: 'tu_other',
          channel: 'stdout',
          chunk: 'hi',
        },
      ],
      ctx2,
    );
    const otherProgress = otherOut.filter(e => e.kind === 'tool_call_progress') as any[];
    expect(otherProgress.length).toBe(1);
    expect(typeof otherProgress[0].seq).toBe('number');
  });

  test('feature 4: system subtype compact_boundary emits compaction event', () => {
    const frames = [
      {
        type: 'system',
        subtype: 'compact_boundary',
        tokens_before: 120000,
        tokens_after: 20000,
        messages_retained: 5,
      },
    ];
    const out = run(frames);
    const compaction = out.find(e => e.kind === 'compaction') as any;
    expect(compaction).toBeDefined();
    expect(compaction.tokensBefore).toBe(120000);
    expect(compaction.tokensAfter).toBe(20000);
    expect(compaction.messagesRetained).toBe(5);
  });

  test('feature 5: input_json_delta emits tool_call_progress with channel=input', () => {
    const ctx = freshCtx();
    const frames = [
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_in' } } },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tu_stream_1',
            name: 'Write',
            input: {},
          },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"path":' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"/tmp/a"}' },
        },
      },
    ];
    const out = run(frames, ctx);
    const inputProgress = out.filter(
      e => e.kind === 'tool_call_progress' && (e as any).channel === 'input',
    ) as any[];
    expect(inputProgress.length).toBe(2);
    expect(inputProgress[0].toolUseId).toBe('tu_stream_1');
    expect(inputProgress[0].chunk).toBe('{"path":');
    expect(inputProgress[1].chunk).toBe('"/tmp/a"}');
    expect(inputProgress[1].seq).toBeGreaterThan(inputProgress[0].seq);
  });
});
