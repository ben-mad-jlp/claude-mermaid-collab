import { describe, it, expect } from 'vitest';
import { groupByTurn, findLastAssistantId, type TimelineItem } from './MessagesTimeline.logic';

const items: TimelineItem[] = [
  { id: 'm1', kind: 'message', role: 'user', turnId: 't1' },
  { id: 'm2', kind: 'message', role: 'assistant', turnId: 't1' },
  { id: 'm3', kind: 'message', role: 'assistant', turnId: 't1' },
  { id: 'm4', kind: 'message', role: 'user', turnId: 't2' },
  { id: 'm5', kind: 'message', role: 'assistant', turnId: 't2' },
];

describe('groupByTurn', () => {
  it('groups adjacent items by turnId', () => {
    const g = groupByTurn(items);
    expect(g.length).toBe(2);
    expect(g[0].items.length).toBe(3);
    expect(g[1].items.length).toBe(2);
  });

  it('handles items without turnId', () => {
    const g = groupByTurn([{ id: 'x', kind: 'message' }]);
    expect(g[0].turnId).toBe('no-turn');
  });
});

describe('findLastAssistantId', () => {
  it('returns the last assistant message id for a turn', () => {
    expect(findLastAssistantId(items, 't1')).toBe('m3');
  });
  it('returns null if no assistant message', () => {
    expect(findLastAssistantId(items, 'none')).toBeNull();
  });
});
