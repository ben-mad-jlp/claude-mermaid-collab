import * as React from 'react';
import { ChatView } from '@/vendored/t3chat/ChatView';
import { ChatMarkdown } from '@/vendored/t3chat/ChatMarkdown';
import { ToolCallCard } from '@/vendored/t3chat/chat/tool-cards/ToolCallCard';
import { useChatViewBindings } from './useChatViewBindings';
import { useAgentStore, type AgentTimelineItem } from '@/stores/agentStore';
import { IdleRecapBanner } from '@/components/agent-chat/IdleRecapBanner';

export interface ChatHostProps {
  sessionId: string;
  header?: React.ReactNode;
  banner?: React.ReactNode;
  rail?: React.ReactNode;
}

function makeRenderItem(streamingMessageId: string | null, sessionId: string) {
  return function renderItem(it: AgentTimelineItem): React.ReactNode {
    if (it.type === 'tool_call') {
      // Sub-agent (Task) inner tool calls render inside the parent Task card's
      // nested view — skip them in the main timeline to avoid duplication.
      if (it.parentTurnId) return null;
      return <ToolCallCard item={it} />;
    }
    if (it.type === 'permission') {
      return (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          permission: {it.name} — {it.status}
        </div>
      );
    }
    const isUser = it.role === 'user';
    // Only show the `…` streaming placeholder when this specific assistant
    // message is actively streaming. Empty assistant messages whose turn has
    // already ended (e.g. turn that only emitted tool calls) render nothing
    // rather than a stuck ellipsis.
    const isStreamingHere = !isUser && it.id === streamingMessageId;
    const content = it.text || (isStreamingHere ? '…' : '');
    if (!isUser && !content) return null;
    return (
      <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
        <div
          className={
            isUser
              ? 'max-w-[85%] rounded-2xl bg-secondary text-secondary-foreground px-4 py-2 text-sm whitespace-pre-wrap'
              : 'w-full text-sm'
          }
        >
          {isUser ? it.text : <ChatMarkdown content={content} />}
          {isUser && it.attachments && it.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {it.attachments.map((att) => {
                const url = `/api/agent/attachments/${att.attachmentId}?sessionId=${encodeURIComponent(sessionId)}`;
                return (
                  <a
                    key={att.attachmentId}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-0.5 rounded-md overflow-hidden border border-white/20 bg-white/10 p-1 hover:opacity-80 transition-opacity"
                  >
                    <img
                      src={url}
                      alt={att.mimeType}
                      className="w-12 h-12 object-cover rounded"
                    />
                    <span className="text-[10px] text-white/60 max-w-[48px] truncate">
                      {att.mimeType.split('/')[1] ?? att.mimeType}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };
}

export const ChatHost: React.FC<ChatHostProps> = ({ sessionId, header, banner, rail }) => {
  const streamingMessageId = useAgentStore((s) => s.streamingMessageId);
  const renderItem = React.useMemo(
    () => makeRenderItem(streamingMessageId, sessionId),
    [streamingMessageId, sessionId]
  );
  const idleRecapBanner = (
    <>
      <IdleRecapBanner sessionId={sessionId} />
      {banner}
    </>
  );
  const props = useChatViewBindings({ sessionId, renderItem, header, banner: idleRecapBanner, rail });
  return <ChatView {...props} />;
};

ChatHost.displayName = 'ChatHost';
