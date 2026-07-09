import { describe, it, expect } from 'vitest';
import { isInboxEpic, INBOX_EPIC_TITLE } from '../claimability';
import type { SessionTodo } from '@/types/sessionTodo';

function mk(over: Partial<SessionTodo> = {}): SessionTodo {
  return {
    id: 'T', ownerSession: 's', assigneeSession: null, assigneeKind: 'agent',
    title: 't', description: null, status: 'planned', completed: false, priority: null,
    dueDate: null, parentId: null, dependsOn: [], order: 0, link: null,
    createdAt: '', updatedAt: '', completedAt: null, asanaGid: null,
    kind: 'leaf',
    ...over,
  };
}

describe('claimability (UI mirror) — Inbox identity', () => {
  it('INBOX_EPIC_TITLE has no role prefix', () => {
    expect(INBOX_EPIC_TITLE).toBe('Inbox');
  });

  it('isInboxEpic: true for a bare-titled Inbox epic', () => {
    expect(isInboxEpic(mk({ title: 'Inbox', kind: 'epic' }))).toBe(true);
  });

  it('isInboxEpic: tolerates the legacy prefixed literal', () => {
    expect(isInboxEpic(mk({ title: '[EPIC] Inbox', kind: 'epic' }))).toBe(true);
  });

  it('isInboxEpic: role comes from kind, never the word alone', () => {
    expect(isInboxEpic(mk({ title: 'Inbox', kind: 'leaf' }))).toBe(false);
  });

  it('isInboxEpic: false for undefined', () => {
    expect(isInboxEpic(undefined)).toBe(false);
  });
});
