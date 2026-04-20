export type TimelineItemKind = 'message' | 'tool_call' | 'permission' | 'thinking' | 'separator';

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  turnId?: string;
  role?: 'user' | 'assistant';
}

export interface TurnGroup {
  turnId: string;
  items: TimelineItem[];
}

export function groupByTurn(items: readonly TimelineItem[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: TurnGroup | null = null;
  for (const it of items) {
    const turnId = it.turnId ?? 'no-turn';
    if (!current || current.turnId !== turnId) {
      current = { turnId, items: [] };
      groups.push(current);
    }
    current.items.push(it);
  }
  return groups;
}

export function findLastAssistantId(items: readonly TimelineItem[], turnId: string): string | null {
  let last: string | null = null;
  for (const it of items) {
    if (it.turnId === turnId && it.kind === 'message' && it.role === 'assistant') {
      last = it.id;
    }
  }
  return last;
}
