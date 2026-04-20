import { randomUUID } from 'crypto';
import type { AgentEvent, ProjectionCtx } from './contracts.js';
import type { EventLog } from './event-log.js';

export function tagParent(toolUseId: string, ctx: ProjectionCtx): string | undefined {
  return ctx.subAgentParentMap.get(toolUseId);
}

export function nextProgressSeq(toolUseId: string, ctx: ProjectionCtx): number {
  const cur = ctx.toolProgressSeq[toolUseId] ?? 0;
  ctx.toolProgressSeq[toolUseId] = cur + 1;
  return cur;
}

export function projectFrame(frame: any, ctx: ProjectionCtx): AgentEvent[] {
  const ts = Date.now();
  try {
    const sessionId = ctx.sessionId;
    const type = frame?.type;

    if (type === 'system') {
      if (frame?.subtype === 'init') {
        return [
          {
            kind: 'session_started',
            sessionId,
            ts,
            claudeSessionId: frame.session_id,
            cwd: frame.cwd,
            resumed: !!ctx.historical,
          },
        ];
      }
      if (frame?.subtype === 'compact_boundary' || frame?.subtype === 'compaction') {
        return [
          {
            kind: 'compaction',
            sessionId,
            ts,
            tokensBefore: frame.tokens_before ?? frame.tokensBefore ?? 0,
            tokensAfter: frame.tokens_after ?? frame.tokensAfter ?? 0,
            messagesRetained: frame.messages_retained ?? frame.messagesRetained ?? 0,
          },
        ];
      }
      return [];
    }

    if (type === 'stream_event') {
      const event = frame.event;
      const evType = event?.type;

      if (evType === 'message_start' || evType === 'sub_agent_message_start') {
        const parentToolUseId = event?.parent_tool_use_id;
        if (parentToolUseId && ctx.turnIdByToolUseId[parentToolUseId]) {
          // Subagent message: do NOT reset currentTurnId; record mapping so inner
          // tool calls can resolve parentTurnId via subAgentParentMap-style lookup.
          ctx.currentAssistantMessageId = event.message?.id ?? randomUUID();
          return [];
        }
        const turnId = ctx.pendingTurnId ?? randomUUID();
        ctx.pendingTurnId = null;
        ctx.currentTurnId = turnId;
        ctx.currentAssistantMessageId = event.message?.id ?? randomUUID();
        ctx.nextDeltaIndex = 0;
        return [{ kind: 'turn_start', sessionId, ts, turnId }];
      }

      if (evType === 'content_block_start' && event?.content_block?.type === 'tool_use') {
        const { id, name, input } = event.content_block;
        if (ctx.seenToolUseIds.has(id)) return [];
        ctx.seenToolUseIds.add(id);
        ctx.toolInputDeltas[id] = '';
        const blockIdx = event.index;
        if (blockIdx != null) ctx.toolUseIdByBlockIndex[String(blockIdx)] = id;
        const turnIdForTool = ctx.currentTurnId ?? randomUUID();
        if (name === 'Task') {
          ctx.turnIdByToolUseId[id] = turnIdForTool;
        }
        // Prefer explicit parent_tool_use_id on the frame (subagent nesting)
        const explicitParentToolUseId = event?.parent_tool_use_id;
        let parentTurnId: string | undefined;
        if (explicitParentToolUseId && ctx.turnIdByToolUseId[explicitParentToolUseId]) {
          parentTurnId = ctx.turnIdByToolUseId[explicitParentToolUseId];
          ctx.subAgentParentMap.set(id, parentTurnId);
        } else {
          parentTurnId = tagParent(id, ctx);
        }
        return [
          {
            kind: 'tool_call_started',
            sessionId,
            ts,
            turnId: turnIdForTool,
            messageId: ctx.currentAssistantMessageId ?? '',
            toolUseId: id,
            name,
            input: input ?? {},
            index: ctx.nextDeltaIndex != null ? ctx.nextDeltaIndex++ : 0,
            historical: ctx.historical,
            ...(parentTurnId ? { parentTurnId } : {}),
          },
        ];
      }

      if (evType === 'content_block_start' && event?.content_block?.type === 'thinking') {
        const key = String(event.index ?? randomUUID());
        ctx.thinkingDeltas[key] = '';
        return [];
      }

      if (evType === 'content_block_delta' && event?.delta?.type === 'thinking_delta') {
        const key = String(event.index ?? '');
        const chunk = event.delta.thinking ?? event.delta.text ?? '';
        if (key) {
          ctx.thinkingDeltas[key] = (ctx.thinkingDeltas[key] ?? '') + chunk;
        }
        return [];
      }

      if (evType === 'content_block_stop') {
        const key = String(event.index ?? '');
        if (key && ctx.thinkingDeltas[key] != null) {
          const text = ctx.thinkingDeltas[key] ?? '';
          delete ctx.thinkingDeltas[key];
          if (text.length > 0) {
            return [
              {
                kind: 'assistant_thinking',
                sessionId,
                ts,
                turnId: ctx.currentTurnId ?? randomUUID(),
                text,
              },
            ];
          }
        }
        return [];
      }

      if (evType === 'content_block_delta' && event?.delta?.type === 'input_json_delta') {
        const key = String(event.index ?? '');
        const partial = event.delta.partial_json ?? '';
        if (key) {
          ctx.toolInputDeltas[key] = (ctx.toolInputDeltas[key] ?? '') + partial;
        }
        const toolUseId = ctx.toolUseIdByBlockIndex[key];
        if (toolUseId && partial) {
          const parentTurnId = tagParent(toolUseId, ctx);
          return [
            {
              kind: 'tool_call_progress',
              sessionId,
              ts,
              toolUseId,
              channel: 'input',
              chunk: partial,
              seq: nextProgressSeq(toolUseId, ctx),
              ...(parentTurnId ? { parentTurnId } : {}),
            },
          ];
        }
        return [];
      }

      if (
        evType === 'content_block_delta' &&
        (event?.delta?.type === 'stdout_delta' || event?.delta?.type === 'stderr_delta')
      ) {
        const key = String(event.index ?? '');
        const toolUseId = ctx.toolUseIdByBlockIndex[key];
        const chunk = event.delta.text ?? event.delta.chunk ?? '';
        if (toolUseId && chunk) {
          const channel: 'stdout' | 'stderr' = event.delta.type === 'stderr_delta' ? 'stderr' : 'stdout';
          const parentTurnId = tagParent(toolUseId, ctx);
          return [
            {
              kind: 'tool_call_progress',
              sessionId,
              ts,
              toolUseId,
              channel,
              chunk,
              seq: nextProgressSeq(toolUseId, ctx),
              ...(parentTurnId ? { parentTurnId } : {}),
            },
          ];
        }
        return [];
      }

      if (evType === 'content_block_delta' && event?.delta?.type === 'text_delta') {
        const out: AgentEvent[] = [];
        if (ctx.currentTurnId == null) {
          const turnId = ctx.pendingTurnId ?? randomUUID();
          ctx.pendingTurnId = null;
          ctx.currentTurnId = turnId;
          ctx.currentAssistantMessageId = randomUUID();
          ctx.nextDeltaIndex = 0;
          out.push({ kind: 'turn_start', sessionId, ts, turnId });
        }
        out.push({
          kind: 'assistant_delta',
          sessionId,
          ts,
          turnId: ctx.currentTurnId!,
          messageId: ctx.currentAssistantMessageId!,
          index: ctx.nextDeltaIndex++,
          text: event.delta.text,
        });
        return out;
      }

      return [];
    }

    if (type === 'assistant') {
      const content = frame?.message?.content ?? [];
      let text = '';
      const toolEvents: AgentEvent[] = [];
      for (const block of content) {
        if (block?.type === 'text') text += block.text ?? '';
        else if (block?.type === 'thinking') {
          const thinkingText = block.thinking ?? block.text ?? '';
          if (thinkingText) {
            toolEvents.push({
              kind: 'assistant_thinking',
              sessionId,
              ts,
              turnId: ctx.currentTurnId ?? randomUUID(),
              text: thinkingText,
            });
          }
        }
        else if (block?.type === 'tool_use') {
          if (ctx.seenToolUseIds.has(block.id)) continue;
          ctx.seenToolUseIds.add(block.id);
          const turnIdForTool = ctx.currentTurnId ?? '';
          if (block.name === 'Task' && turnIdForTool) {
            ctx.turnIdByToolUseId[block.id] = turnIdForTool;
          }
          const parentTurnId = tagParent(block.id, ctx);
          toolEvents.push({
            kind: 'tool_call_started',
            sessionId,
            ts,
            turnId: turnIdForTool,
            messageId: frame.message.id ?? '',
            toolUseId: block.id,
            name: block.name,
            input: block.input ?? {},
            index: 0,
            historical: ctx.historical,
            ...(parentTurnId ? { parentTurnId } : {}),
          });
        }
      }
      ctx.currentAssistantMessageId = frame.message.id;
      return [
        ...toolEvents,
        {
          kind: 'assistant_message_complete',
          sessionId,
          ts,
          turnId: ctx.currentTurnId ?? randomUUID(),
          messageId: frame.message.id,
          text,
          historical: ctx.historical,
        },
      ];
    }

    if (type === 'user') {
      const content = frame?.message?.content ?? [];
      const out: AgentEvent[] = [];
      for (const block of content) {
        if (block?.type === 'tool_result') {
          if (ctx.completedToolUseIds.has(block.tool_use_id)) continue;
          ctx.completedToolUseIds.add(block.tool_use_id);
          const parentTurnId = tagParent(block.tool_use_id, ctx);
          // If this tool_result is from a Task tool_use, any nested tool calls
          // carried inside the result should be parented to the Task's turnId.
          const parentFromTask = ctx.turnIdByToolUseId[block.tool_use_id];
          if (parentFromTask) {
            const nested = Array.isArray(block.content) ? block.content : [];
            for (const inner of nested) {
              if (inner?.type === 'tool_use' && inner?.id) {
                ctx.subAgentParentMap.set(inner.id, parentFromTask);
              }
            }
          }
          out.push({
            kind: 'tool_call_completed',
            sessionId,
            ts,
            toolUseId: block.tool_use_id,
            status: block.is_error ? 'error' : 'ok',
            output: block.content,
            historical: ctx.historical,
            ...(parentTurnId ? { parentTurnId } : {}),
          });
        }
      }
      return out;
    }

    if (type === 'tool_progress') {
      const toolUseId = frame.toolUseId ?? frame.tool_use_id;
      const channel = frame.channel;
      const chunk = frame.chunk ?? '';
      if (toolUseId && (channel === 'stdout' || channel === 'stderr')) {
        const parentTurnId = tagParent(toolUseId, ctx);
        return [
          {
            kind: 'tool_call_progress',
            sessionId,
            ts,
            toolUseId,
            channel,
            chunk,
            seq: nextProgressSeq(toolUseId, ctx),
            ...(parentTurnId ? { parentTurnId } : {}),
          },
        ];
      }
      return [];
    }

    if (type === 'rate_limit_event') {
      return [];
    }

    if (type === 'hook_event') {
      return [];
    }

    if (type === 'result') {
      const turnId = ctx.currentTurnId ?? randomUUID();
      const usage = frame.usage
        ? {
            inputTokens: frame.usage.input_tokens ?? 0,
            outputTokens: frame.usage.output_tokens ?? 0,
            costUsd: frame.total_cost_usd,
          }
        : undefined;
      const ev: AgentEvent = {
        kind: 'turn_end',
        sessionId,
        ts,
        turnId,
        usage,
        stopReason: frame.stop_reason,
      };
      ctx.currentTurnId = null;
      ctx.currentAssistantMessageId = null;
      ctx.nextDeltaIndex = 0;
      return [ev];
    }

    return [
      {
        kind: 'error',
        sessionId,
        ts,
        where: 'parse',
        message: `unknown frame type: ${frame?.type}`,
        recoverable: true,
      },
    ];
  } catch (err) {
    return [
      {
        kind: 'error',
        sessionId: ctx.sessionId,
        ts: Date.now(),
        where: 'parse',
        message: String(err),
        recoverable: true,
      },
    ];
  }
}

/**
 * Projector wraps the pure `projectFrame` function and routes the emitted
 * batch through an injected EventLog so every broadcast event carries a
 * persisted monotonic `seq`. The EventLog is injected (not imported as a
 * module singleton) to keep the class testable.
 */
export class Projector {
  constructor(private readonly eventLog: EventLog) {}

  /**
   * Project a single frame into events and append them as one atomic batch
   * to the EventLog. Returns the stamped events (with `seq` assigned).
   */
  project(frame: unknown, ctx: ProjectionCtx): AgentEvent[] {
    const events = projectFrame(frame, ctx);
    if (events.length === 0) return [];
    return this.eventLog.append(ctx.sessionId, events);
  }

  /**
   * Append a caller-synthesized batch (events not produced by projectFrame,
   * e.g. session_started, worktree_info, cancel synthetics) through the same
   * EventLog path so they also get a `seq`.
   */
  appendSynthetic(sessionId: string, events: AgentEvent[]): AgentEvent[] {
    if (events.length === 0) return [];
    return this.eventLog.append(sessionId, events);
  }
}
