import * as React from 'react';
import { ChatView } from '@/vendored/t3chat/ChatView';
import { ChatMarkdown } from '@/vendored/t3chat/ChatMarkdown';
import { ToolCallCard } from '@/vendored/t3chat/chat/tool-cards/ToolCallCard';
import { useChatViewBindings } from './useChatViewBindings';
import type { AgentTimelineItem } from '@/stores/agentStore';

export interface ChatHostProps {
  sessionId: string;
  header?: React.ReactNode;
  banner?: React.ReactNode;
  rail?: React.ReactNode;
}

function renderItem(it: AgentTimelineItem): React.ReactNode {
  if (it.type === 'tool_call') {
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
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-2xl bg-secondary text-secondary-foreground px-4 py-2 text-sm whitespace-pre-wrap'
            : 'w-full text-sm'
        }
      >
        {isUser ? it.text : <ChatMarkdown content={it.text || '…'} />}
      </div>
    </div>
  );
}

export const ChatHost: React.FC<ChatHostProps> = ({ sessionId, header, banner, rail }) => {
  const props = useChatViewBindings({ sessionId, renderItem, header, banner, rail });
  return <ChatView {...props} />;
};

ChatHost.displayName = 'ChatHost';
