/**
 * Unit tests for claimability.ts (epic b2c858d4 S2) — the single eligibility predicate.
 * Pure; no DB. Exercises every ClaimReason branch, the dep-rejected-before-deps-pending
 * ordering, the orphan-as-null claim, the human-assignee split, and derivedStatus.
 */
import { describe, it, expect } from 'bun:test';
import { depSatisfied, claimReason, isClaimable, derivedStatus } from '../claimability';
import type { Todo } from '../todo-store';

function mk(over: Partial<Todo> = {}): Todo {
  return {
    id: 'T', ownerSession: 's', assigneeSession: null, assigneeKind: 'agent',
    title: 't', description: null, status: 'planned', completed: false, priority: null,
    dueDate: null, parentId: null, dependsOn: [], order: 0, link: null,
    createdAt: '', updatedAt: '', completedAt: null, asanaGid: null, sessionName: null,
    executedBySession: null, blueprintId: null, type: null, targetProject: null,
    acceptanceStatus: null, claimedBy: null, claimToken: null, claimedAt: null,
    claimLeaseMs: null, claim: null, approvedAt: null, approvedBy: null, heldAt: null,
    heldReason: null, retryCount: 0, completedBy: null, objectRef: null, decisionRef: null,
    claimProbe: null, ...over,
  };
}
const APPROVED = '2026-06-17T00:00:00Z';
const CLAIM = { by: 'coordinator', token: 'tok', at: APPROVED, leaseMs: 1000 };
const map = (...todos: Todo[]) => new Map(todos.map((t) => [t.id, t]));

describe('depSatisfied', () => {
  it('done + not-rejected = satisfied; everything else not', () => {
    expect(depSatisfied(mk({ status: 'done', acceptanceStatus: 'accepted' }))).toBe(true);
    expect(depSatisfied(mk({ status: 'done', acceptanceStatus: null }))).toBe(true);
    expect(depSatisfied(mk({ status: 'done', acceptanceStatus: 'rejected' }))).toBe(false); // the behavior change
    expect(depSatisfied(mk({ status: 'in_progress' }))).toBe(false);
    expect(depSatisfied(undefined)).toBe(false);
  });
});

describe('claimReason — each branch', () => {
  const approved = { approvedAt: APPROVED };
  it('terminal: done|dropped (wins over everything)', () => {
    expect(claimReason(mk({ status: 'done', claim: CLAIM }), map())).toBe('terminal');
    expect(claimReason(mk({ status: 'dropped' }), map())).toBe('terminal');
  });
  it('in-flight: claim != null', () => {
    expect(claimReason(mk({ status: 'planned', claim: CLAIM, ...approved }), map())).toBe('in-flight');
  });
  it('unapproved: approvedAt == null (before hold/deps)', () => {
    expect(claimReason(mk({ heldAt: APPROVED }), map())).toBe('unapproved');
  });
  it('held: heldAt != null (after approval)', () => {
    expect(claimReason(mk({ ...approved, heldAt: APPROVED }), map())).toBe('held');
  });
  it('dep-rejected BEFORE deps-pending', () => {
    const dep = mk({ id: 'D', status: 'done', acceptanceStatus: 'rejected' });
    const pending = mk({ id: 'P', status: 'in_progress' });
    const t = mk({ ...approved, dependsOn: ['D', 'P'] });
    expect(claimReason(t, map(dep, pending))).toBe('dep-rejected');
  });
  it('deps-pending: a dep not yet terminal', () => {
    const dep = mk({ id: 'D', status: 'in_progress' });
    const t = mk({ ...approved, dependsOn: ['D'] });
    expect(claimReason(t, map(dep))).toBe('deps-pending');
  });
  it('human-assignee: fully unblocked + approved human → not auto-claimed', () => {
    const t = mk({ ...approved, assigneeKind: 'human' });
    expect(claimReason(t, map())).toBe('human-assignee');
  });
  it('claimable: agent, approved, unheld, no deps', () => {
    expect(claimReason(mk({ ...approved }), map())).toBe('claimable');
    const dep = mk({ id: 'D', status: 'done', acceptanceStatus: 'accepted' });
    expect(claimReason(mk({ ...approved, dependsOn: ['D'] }), map(dep))).toBe('claimable');
  });
  it('decision gates apply to human todos too (unapproved/held/deps come before human-assignee)', () => {
    expect(claimReason(mk({ assigneeKind: 'human' }), map())).toBe('unapproved');
    const dep = mk({ id: 'D', status: 'in_progress' });
    expect(claimReason(mk({ assigneeKind: 'human', approvedAt: APPROVED, dependsOn: ['D'] }), map(dep))).toBe('deps-pending');
  });
});

describe('isClaimable', () => {
  it('true only for the claimable reason', () => {
    expect(isClaimable(mk({ approvedAt: APPROVED }), map())).toBe(true);
    expect(isClaimable(mk({ approvedAt: APPROVED, heldAt: APPROVED }), map())).toBe(false);
    expect(isClaimable(mk({ assigneeKind: 'human', approvedAt: APPROVED }), map())).toBe(false);
  });
});

describe('derivedStatus (legacy-shaped label)', () => {
  it('maps derived state to the old enum vocabulary', () => {
    expect(derivedStatus(mk({ status: 'done' }), map())).toBe('done');
    expect(derivedStatus(mk({ status: 'dropped' }), map())).toBe('dropped');
    expect(derivedStatus(mk({ claim: CLAIM }), map())).toBe('in_progress');
    expect(derivedStatus(mk({ approvedAt: APPROVED }), map())).toBe('ready');
    expect(derivedStatus(mk({}), map())).toBe('planned'); // unapproved
    expect(derivedStatus(mk({ approvedAt: APPROVED, heldAt: APPROVED }), map())).toBe('blocked');
  });
});
