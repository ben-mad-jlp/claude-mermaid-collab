import * as React from 'react';
import { cn } from './lib/utils';
import { MessagesTimeline } from './chat/MessagesTimeline';
import type { TimelineItem } from './chat/MessagesTimeline.logic';
import { ChatComposer, type ChatComposerProps } from './chat/ChatComposer';

export interface ChatViewProps {
  items: readonly TimelineItem[];
  renderItem: (item: TimelineItem) => React.ReactNode;
  renderTurnSeparator?: (turnId: string, isFirst: boolean) => React.ReactNode;
  emptyState?: React.ReactNode;
  composer: ChatComposerProps;
  header?: React.ReactNode;
  banner?: React.ReactNode;
  rail?: React.ReactNode;
  className?: string;
}

export const ChatView: React.FC<ChatViewProps> = ({
  items,
  renderItem,
  renderTurnSeparator,
  emptyState,
  composer,
  header,
  banner,
  rail,
  className,
}) => {
  return (
    <div className={cn('flex h-full flex-col bg-background text-foreground', className)}>
      {header ? <div className="shrink-0 border-b">{header}</div> : null}
      {banner ? <div className="shrink-0">{banner}</div> : null}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          <MessagesTimeline
            items={items}
            renderItem={renderItem}
            renderTurnSeparator={renderTurnSeparator}
            emptyState={emptyState}
          />
        </div>
        {rail ? <div className="w-60 shrink-0 border-l overflow-auto">{rail}</div> : null}
      </div>
      <div className="shrink-0">
        <ChatComposer {...composer} />
      </div>
    </div>
  );
};

ChatView.displayName = 'ChatView';
