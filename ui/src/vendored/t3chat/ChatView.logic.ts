import type { TimelineItem } from './chat/MessagesTimeline.logic';

export interface ChatViewState {
  itemCount: number;
  hasStreaming: boolean;
  hasPendingApproval: boolean;
}

export function summarize(items: readonly TimelineItem[], streamingId: string | null, pendingId: string | null): ChatViewState {
  return {
    itemCount: items.length,
    hasStreaming: !!streamingId,
    hasPendingApproval: !!pendingId,
  };
}
