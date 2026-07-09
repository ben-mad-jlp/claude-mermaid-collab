import { describe, it, expect } from 'vitest';
import { isInboxEpic, INBOX_EPIC_TITLE, claimReason, derivedStatus, isClaimable, buildById } from '../claimability';
import type { SessionTodo } from '@/types/sessionTodo';
import cases from '../../../../src/services/__tests__/fixtures/claimability-cases.json';

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

describe('claimability (UI mirror) — shared fixture (claimability-cases.json)', () => {
  it('fixture schemaVersion is 1', () => {
    expect(cases.schemaVersion).toBe(1);
  });

  for (const c of cases.cases) {
    it(c.name, () => {
      const todos = c.todos.map((t) => mk(t as Partial<SessionTodo>));
      const byId = buildById(todos);
      const subject = byId.get(c.subject)!;
      const failMsg = c.why;

      expect(claimReason(subject, byId), failMsg).toBe(c.expect.claimReason);
      expect(derivedStatus(subject, byId), failMsg).toBe(c.expect.derivedStatus);
      expect(isClaimable(subject, byId), failMsg).toBe(c.expect.isClaimable);
    });
  }
});
