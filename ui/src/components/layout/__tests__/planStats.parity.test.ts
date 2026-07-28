/**
 * planStats.parity.test.ts — shared-fixture parity test: projectPlanStats counts ===
 * computePlanTotals counts, including the bucket-planning divergence-class guard.
 *
 * REGRESSION: bucket-planning todos (children of Inbox) report 'blocked' via
 * derivedStatus but fall through to 'backlog' in the funnel classifier. This test
 * ensures the Plan surface (computePlanTotals) and the badge surface (projectPlanStats)
 * agree on both the old derivedStatus-divergence and the corrected funnel behavior.
 */
import { describe, it, expect } from 'vitest';
import { projectPlanStats } from '../SupervisorPanel';
import { computePlanTotals } from '@/components/supervisor/PlanTotals';
import { bucketTodo, todosInSegment } from '@/components/supervisor/bridge/funnel';
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

describe('projectPlanStats ↔ computePlanTotals parity', () => {
  const epic1 = todo({ id: 'epic-1', kind: 'epic', parentId: null });
  const mission1 = todo({ id: 'mission-1', kind: 'mission', parentId: null });
  const leafUnapproved = todo({
    id: 'leaf-unapproved',
    parentId: 'epic-1',
    approvedAt: null,
  });
  const leafBlocked = todo({
    id: 'leaf-blocked',
    parentId: 'epic-1',
    dependsOn: ['leaf-unapproved'],
  });
  const leafReady = todo({
    id: 'leaf-ready',
    parentId: 'epic-1',
    dependsOn: [],
  });
  const leafInflight = todo({
    id: 'leaf-inflight',
    parentId: 'epic-1',
    claim: { by: 'w1', token: 't', at: '2026-07-28T00:00:00Z', leaseMs: 60000 },
  });

  const leaves = [leafBlocked, leafReady, leafUnapproved, leafInflight];
  const fixture = [epic1, mission1, ...leaves];

  it('strict parity + value: blocked count matches and equals 1', () => {
    const stats = projectPlanStats(fixture);
    const totals = computePlanTotals(fixture);
    expect(stats.blocked).toBe(totals.counts.blocked);
    expect(stats.blocked).toBe(1);
  });

  it('backlog naming: computePlanTotals.counts.backlog === 1 and names the unapproved leaf', () => {
    const totals = computePlanTotals(fixture);
    expect(totals.counts.backlog).toBe(1);
    const backlogLeaves = todosInSegment(leaves, 'backlog');
    expect(backlogLeaves.map((t) => t.id)).toEqual(['leaf-unapproved']);
  });

  it('container exclusion: epic and mission not counted in open/total', () => {
    const stats = projectPlanStats(fixture);
    const totals = computePlanTotals(fixture);
    expect(stats.open).toBe(4); // 4 leaves only
    expect(totals.total).toBe(4); // 4 leaves only
  });

  it('divergence-class regression: bucket-planning falls through to backlog, not counted as blocked', () => {
    const inboxEpic = todo({ id: 'inbox-epic', kind: 'epic', parentId: null, title: 'Inbox' });
    const bucketPlanningLeaf = todo({
      id: 'bucket-planning-leaf',
      parentId: 'inbox-epic',
      dependsOn: [],
    });
    const extended = [...fixture, inboxEpic, bucketPlanningLeaf];

    const totals = computePlanTotals(extended);
    // bucket-planning → claimReason='bucket-planning' → derivedStatus='blocked' but
    // funnel.bucketTodo does NOT match 'blocked' (doesn't match ready/inflight/blocked predicates)
    // so falls through to backlog catch-all.
    expect(totals.counts.blocked).toBe(1); // NOT 2 (the old regression)
    expect(totals.counts.backlog).toBe(2); // leaf-unapproved + bucket-planning-leaf
    const stats = projectPlanStats(extended);
    expect(stats.blocked).toBe(1);
    expect(stats.backlog).toBe(2);
  });

  it('numbers move together under mutation: approval flip moves both surfaces identically', () => {
    const mutated = fixture.map((t) =>
      t.id === 'leaf-unapproved' ? { ...t, approvedAt: '2026-06-16T00:00:00Z' } : t,
    );

    const totalsAfter = computePlanTotals(mutated);
    expect(totalsAfter.counts.backlog).toBe(0);
    expect(totalsAfter.counts.ready).toBe(2); // leaf-unapproved (now approved, no deps) + leaf-ready

    const statsAfter = projectPlanStats(mutated);
    expect(statsAfter.backlog).toBe(0);
    expect(statsAfter.ready).toBe(2);
  });
});
