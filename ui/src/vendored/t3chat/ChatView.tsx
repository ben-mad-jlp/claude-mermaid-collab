import * as React from 'react';
import { cn } from './lib/utils';
import { MessagesTimeline } from './chat/MessagesTimeline';
import type { TimelineItem } from './chat/MessagesTimeline.logic';
import { ChatComposer, type ChatComposerProps } from './chat/ChatComposer';
import { UserInputCard } from './chat/UserInputCard';
import type { PendingUserInputItem, CompactionEntry } from '@/stores/agentStore';
import type { UserInputValue } from '@/types/agent';

export interface ChatViewProps {
  items: readonly TimelineItem[];
  renderItem: (item: TimelineItem) => React.ReactNode;
  renderTurnSeparator?: (turnId: string, isFirst: boolean) => React.ReactNode;
  emptyState?: React.ReactNode;
  composer: ChatComposerProps;
  header?: React.ReactNode;
  banner?: React.ReactNode;
  rail?: React.ReactNode;
  pendingUserInput?: PendingUserInputItem | null;
  onRespondUserInput?: (promptId: string, value: UserInputValue) => void;
  checkpointsByTurn?: Record<string, { firstSeq: number; stashSha: string }>;
  onRevertToCheckpoint?: (turnId: string) => void;
  currentTurnId?: string | null;
  compactions?: readonly CompactionEntry[];
  thinkingByTurn?: Record<string, string>;
  modelByTurn?: Record<string, string>;
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
  pendingUserInput,
  onRespondUserInput,
  checkpointsByTurn,
  onRevertToCheckpoint,
  currentTurnId,
  compactions,
  thinkingByTurn,
  modelByTurn,
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
            checkpointsByTurn={checkpointsByTurn}
            onRevertToCheckpoint={onRevertToCheckpoint}
            currentTurnId={currentTurnId}
            compactions={compactions}
            thinkingByTurn={thinkingByTurn}
            modelByTurn={modelByTurn}
          />
        </div>
        {rail ? <div className="w-60 shrink-0 border-l overflow-auto">{rail}</div> : null}
      </div>
      {pendingUserInput && onRespondUserInput ? (
        <div className="shrink-0 border-t bg-background px-3 pt-3">
          <UserInputCard
            promptId={pendingUserInput.promptId}
            prompt={pendingUserInput.prompt}
            expectedKind={pendingUserInput.expectedKind}
            choices={pendingUserInput.choices}
            deadlineMs={pendingUserInput.deadlineMs}
            onRespond={(value) => onRespondUserInput(pendingUserInput.promptId, value)}
          />
        </div>
      ) : null}
      <div className="shrink-0">
        <ChatComposer {...composer} />
      </div>
    </div>
  );
};

ChatView.displayName = 'ChatView';
