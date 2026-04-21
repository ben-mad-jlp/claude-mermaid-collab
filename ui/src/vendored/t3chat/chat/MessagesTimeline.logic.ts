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
  let noTurnCounter = 0;
  for (const it of items) {
    const rawTurnId = it.turnId;
    // Items without a turnId each start their own group with a unique key so
    // React doesn't complain about duplicate keys.
    const turnId = rawTurnId ?? `no-turn-${noTurnCounter++}`;
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
