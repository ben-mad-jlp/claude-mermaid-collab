/**
 * TodoDetailView.badge.test.tsx — unit tests for badgeState helper
 *
 * Ensures that badgeState drives the status badge from funnel.liveBucketTodo,
 * not from derivedStatus, and correctly handles the bucket-planning divergence-class case.
 */
import { describe, it, expect } from 'vitest';
import { badgeState, type BadgeKey } from '../TodoDetailView';
import { liveBucketTodo } from '@/components/supervisor/bridge/funnel';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: null,
    title: p.id,
    description: null,
    status: 'planned',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    approvedAt: '2026-06-16T00:00:00Z',
    heldAt: null,
    claim: null,
    acceptanceStatus: null,
    assigneeKind: null,
    claimedBy: null,
    kind: 'leaf',
    ...p,
  } as SessionTodo;
}

function buildById(todos: SessionTodo[]): Map<string, SessionTodo> {
  return new Map(todos.map((t) => [t.id, t]));
}

describe('badgeState', () => {
  it('bucket-planning leaf (parent = Inbox epic): key === backlog, not blocked', () => {
    const inboxEpic = todo({ id: 'inbox-epic', kind: 'epic', parentId: null, title: 'Inbox' });
    const bucketPlanningLeaf = todo({
      id: 'bucket-planning-leaf',
      parentId: 'inbox-epic',
      dependsOn: [],
      status: 'planned',
    });
    const byId = buildById([inboxEpic, bucketPlanningLeaf]);

    const badge = badgeState(bucketPlanningLeaf, byId, false);
    const liveBucket = liveBucketTodo(bucketPlanningLeaf, byId);

    expect(badge.key).toBe('backlog');
    expect(liveBucket).toBe('backlog');
    expect(badge.key).not.toBe('blocked');
  });

  it('leaf with unapproved dependency: key === blocked', () => {
    const epic = todo({ id: 'epic-1', kind: 'epic', parentId: null });
    const unapprovedDep = todo({
      id: 'unapproved-dep',
      parentId: 'epic-1',
      approvedAt: null,
    });
    const blockedLeaf = todo({
      id: 'blocked-leaf',
      parentId: 'epic-1',
      dependsOn: ['unapproved-dep'],
    });
    const byId = buildById([epic, unapprovedDep, blockedLeaf]);

    const badge = badgeState(blockedLeaf, byId, false);

    expect(badge.key).toBe('blocked');
  });

  it('held todo (blocked bucket): label === "on hold"', () => {
    const epic = todo({ id: 'epic-1', kind: 'epic', parentId: null });
    const heldLeaf = todo({
      id: 'held-leaf',
      parentId: 'epic-1',
      heldAt: '2026-06-16T00:00:00Z',
    });
    const byId = buildById([epic, heldLeaf]);

    const badge = badgeState(heldLeaf, byId, true);

    expect(badge.key).toBe('blocked');
    expect(badge.label).toBe('on hold');
  });

  it('status: done: key === done, label === done', () => {
    const doneLeaf = todo({
      id: 'done-leaf',
      status: 'done',
    });
    const byId = buildById([doneLeaf]);

    const badge = badgeState(doneLeaf, byId, false);

    expect(badge.key).toBe('done');
    expect(badge.label).toBe('done');
  });

  it('status: dropped: key === dropped, label === dropped', () => {
    const droppedLeaf = todo({
      id: 'dropped-leaf',
      status: 'dropped',
    });
    const byId = buildById([droppedLeaf]);

    const badge = badgeState(droppedLeaf, byId, false);

    expect(badge.key).toBe('dropped');
    expect(badge.label).toBe('dropped');
  });
});
