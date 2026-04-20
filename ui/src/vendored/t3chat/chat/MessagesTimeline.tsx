import * as React from 'react';
import { cn } from '../lib/utils';
import { groupByTurn, type TimelineItem } from './MessagesTimeline.logic';

export interface MessagesTimelineProps {
  items: readonly TimelineItem[];
  renderItem: (item: TimelineItem) => React.ReactNode;
  renderTurnSeparator?: (turnId: string, isFirst: boolean) => React.ReactNode;
  emptyState?: React.ReactNode;
  className?: string;
}

export const MessagesTimeline: React.FC<MessagesTimelineProps> = ({
  items,
  renderItem,
  renderTurnSeparator,
  emptyState,
  className,
}) => {
  if (items.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full text-sm text-muted-foreground', className)}>
        {emptyState ?? 'No messages yet'}
      </div>
    );
  }
  const groups = groupByTurn(items);
  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3', className)}>
      {groups.map((group, gi) => (
        <React.Fragment key={group.turnId}>
          {renderTurnSeparator ? renderTurnSeparator(group.turnId, gi === 0) : null}
          {group.items.map((it) => (
            <React.Fragment key={it.id}>{renderItem(it)}</React.Fragment>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
};

MessagesTimeline.displayName = 'MessagesTimeline';
