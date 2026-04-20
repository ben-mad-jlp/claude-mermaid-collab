import React, { useState } from 'react';
import {
  useAgentStore,
  type AgentMessage,
  type AgentTimelineItem,
  type AgentPermissionItem,
  type AgentToolCallItem,
} from '@/stores/agentStore';
import type { PermissionDecision } from '@/types/agent';
import { Markdown } from '@/components/ai-ui/display/Markdown';
import ToolCallCard from './tool-cards/ToolCallCard';
import PermissionCard from './PermissionCard';
import ThinkingBlock from './ThinkingBlock';
import CompactionNotice from './CompactionNotice';
import TurnFooter from './TurnFooter';
import { parseCitations, type ToolCallRef } from '../../lib/citations';
import { groupTimeline, type GroupedTimelineItem, type TimelineGroup } from '../../lib/timeline-group';

export interface MessageListProps {
  timeline: AgentTimelineItem[];
  streamingMessageId: string | null;
  onResolvePermission: (promptId: string, decision: PermissionDecision) => void;
}

/**
 * Render an assistant message body with citation chips. Each `[[Tool#N]]`
 * marker is replaced by a button-like chip that can be followed to the
 * referenced tool call.
 */
function renderCitationSegments(text: string, toolCalls: ToolCallRef[]) {
  const segments = parseCitations(text, toolCalls);
  if (segments.length === 0) {
    return <Markdown content={text} unstyled />;
  }
  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return <Markdown key={i} content={seg.value} unstyled />;
        }
        return (
          <a
            key={i}
            href={`#toolcall-${seg.toolUseId ?? ''}`}
            data-toolcall-id={seg.toolUseId}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60"
            title={`Jump to ${seg.toolName} call`}
          >
            {seg.toolName}#{seg.index}
          </a>
        );
      })}
    </span>
  );
}

/**
 * Compute toolCalls refs (id + name) up to the current item index so
 * parseCitations can resolve `[[Read#2]]` style markers.
 */
function collectToolCallRefs(timeline: AgentTimelineItem[]): ToolCallRef[] {
  return timeline
    .filter((t): t is AgentToolCallItem => t.type === 'tool_call')
    .map((t) => ({ id: t.id, name: t.name }));
}

interface GroupedReadRowProps {
  group: TimelineGroup;
}

const GroupedReadRow: React.FC<GroupedReadRowProps> = ({ group }) => {
  const [expanded, setExpanded] = useState(false);
  const label =
    group.kind === 'read'
      ? `${group.items.length} grouped Read calls`
      : `${group.items.length} grouped Grep calls`;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="self-start text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        aria-expanded={expanded}
        data-testid="timeline-group-toggle"
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{' '}
        {label}
        {group.commonPrefix ? (
          <span className="ml-1 font-mono text-gray-500">({group.commonPrefix}/…)</span>
        ) : null}
      </button>
      {expanded && (
        <div className="flex flex-col gap-1 pl-4">
          {group.items.map((it) => (
            <div key={it.id} className="flex justify-start">
              <ToolCallCard item={it} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const MessageList: React.FC<MessageListProps> = ({ timeline, streamingMessageId, onResolvePermission }) => {
  const thinkingBlocks = useAgentStore((s) => s.thinkingBlocks);
  const currentTurnId = useAgentStore((s) => s.currentTurnId);
  const turnUsage = useAgentStore((s) => s.usage);

  if (timeline.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">
        No messages yet
      </div>
    );
  }

  const toolCallRefs = collectToolCallRefs(timeline);
  const grouped: GroupedTimelineItem[] = groupTimeline(timeline);

  // Determine which message concludes each turn (for TurnFooter).
  // Heuristic: last assistant message per turnId that is not currently streaming.
  const lastAssistantByTurn = new Map<string, string>();
  for (const item of timeline) {
    if (item.type === 'message') {
      const m = item as AgentMessage;
      if (m.role === 'assistant' && m.turnId) {
        lastAssistantByTurn.set(m.turnId, m.id);
      }
    }
  }

  return (
    <>
      {grouped.map((entry) => {
        // Grouped Read/Grep runs — render as a single collapsible row.
        if ((entry as TimelineGroup).type === 'group') {
          const group = entry as TimelineGroup;
          return <GroupedReadRow key={group.id} group={group} />;
        }

        const item = entry as AgentTimelineItem;

        // Compaction notice (synthetic kind; defensive check — store may not emit yet).
        // TODO: wire real compaction events into AgentTimelineItem union.
        const anyItem = item as AgentTimelineItem & {
          kind?: string;
          tokensBefore?: number;
          tokensAfter?: number;
          messagesRetained?: number;
          ts?: number;
        };
        if (anyItem.kind === 'compaction') {
          return (
            <CompactionNotice
              key={(item as { id?: string }).id ?? `compaction-${anyItem.ts ?? Math.random()}`}
              tokensBefore={anyItem.tokensBefore}
              tokensAfter={anyItem.tokensAfter}
              messagesRetained={anyItem.messagesRetained}
              ts={anyItem.ts}
            />
          );
        }

        // Assistant thinking slice — rendered inline before the assistant body.
        // TODO: once store emits discrete `assistant_thinking` timeline items, render them here.
        if (anyItem.kind === 'assistant_thinking') {
          const t = item as AgentTimelineItem & { text?: string; streaming?: boolean };
          return (
            <div key={(item as { id?: string }).id ?? 'thinking'} className="flex justify-start">
              <ThinkingBlock text={t.text ?? ''} streaming={t.streaming} />
            </div>
          );
        }

        if (item.type === 'permission') {
          return (
            <div key={item.id} className="flex justify-start">
              <PermissionCard item={item as AgentPermissionItem} onResolve={onResolvePermission} />
            </div>
          );
        }

        if (item.type === 'tool_call') {
          return (
            <div key={item.id} className="flex justify-start" id={`toolcall-${item.id}`}>
              <ToolCallCard item={item} />
            </div>
          );
        }

        const m = item as AgentMessage;
        const isUser = m.role === 'user';
        const isHistorical = Boolean(m.historical);
        const isStreaming = m.id === streamingMessageId;
        // For assistant messages, render the thinking block (if any) for this turn
        // immediately before the body.
        const thinkingText = !isUser && m.turnId ? thinkingBlocks[m.turnId] : undefined;
        const thinkingStreaming = !isUser && m.turnId != null && m.turnId === currentTurnId;

        const bubbleClasses = [
          'text-sm whitespace-pre-wrap break-words',
          isUser
            ? 'max-w-[85%] rounded-2xl px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
            : 'text-gray-900 dark:text-gray-100',
          isHistorical ? 'opacity-60 italic' : '',
        ].join(' ');

        // Decide if this message is the last assistant message in its turn (for footer).
        const isTurnTail =
          !isUser &&
          m.turnId != null &&
          lastAssistantByTurn.get(m.turnId) === m.id &&
          m.id !== streamingMessageId;

        // TODO: turn-level usage/stopReason/canceled/elapsedMs are not tracked per-turn in
        // the store yet; we only have a single top-level `usage`. Pass defensively.
        const turnMeta = item as AgentTimelineItem & {
          stopReason?: string;
          canceled?: boolean;
          elapsedMs?: number;
        };

        return (
          <div key={m.id} className="flex flex-col gap-1">
            <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex flex-col gap-1 ${isUser ? 'items-end max-w-[85%]' : 'w-full'}`}>
                {!isUser && thinkingText ? (
                  <ThinkingBlock text={thinkingText} streaming={thinkingStreaming} />
                ) : null}
                <div className={bubbleClasses}>
                  {isUser ? (
                    <div>{m.text}</div>
                  ) : m.text ? (
                    renderCitationSegments(m.text, toolCallRefs)
                  ) : (
                    <span>…</span>
                  )}
                  {isStreaming && (
                    <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse align-text-bottom" />
                  )}
                </div>
                {isTurnTail && (
                  <TurnFooter
                    usage={turnUsage ?? undefined}
                    stopReason={turnMeta.stopReason}
                    canceled={turnMeta.canceled}
                    elapsedMs={turnMeta.elapsedMs}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};

MessageList.displayName = 'MessageList';
