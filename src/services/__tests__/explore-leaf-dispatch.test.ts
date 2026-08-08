import { describe, it, expect } from 'bun:test';
import { leafExecutionMode, leafRunKinds, exploreInflightBlocked } from '../leaf-execution-mode';
import { claimReason } from '../claimability';
import type { Todo, ClaimStruct } from '../todo-store';

/**
 * Minimal fabricated Todo for testing — only includes fields that the dispatch
 * and claimability logic reads.
 */
function makeTodo(overrides: Partial<Todo>): Todo {
  return {
    id: 'test-' + Math.random().toString(36).slice(2),
    ownerSession: 's1',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: 'test',
    description: null,
    status: 'ready',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '2026-08-07T00:00:00Z',
    updatedAt: '2026-08-07T00:00:00Z',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    kind: 'leaf',
    tier: 'full',
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    claim: null,
    approvedAt: '2026-08-07T00:00:00Z',
    approvedBy: 's1',
    heldAt: null,
    heldReason: null,
    landedAt: null,
    hollowLandedAt: null,
    retryCount: 0,
    baseMovedRefunds: 0,
    baseRepair: 0,
    completedBy: null,
    objectRef: null,
    servesCriterionId: null,
    servesCriterionIds: [],
    decisionRef: null,
    claimProbe: null,
    inheritedBlueprintFrom: null,
    inheritedFiles: [],
    declaredFiles: [],
    isBucket: false,
    ...overrides,
  };
}

describe('leafExecutionMode: explore dispatch', () => {
  it('returns explore for explore-typed leaves (case-insensitive)', () => {
    const exploreLeaf = makeTodo({ type: 'explore' });
    expect(leafExecutionMode(exploreLeaf)).toBe('explore');

    const exploreCapital = makeTodo({ type: 'Explore' });
    expect(leafExecutionMode(exploreCapital)).toBe('explore');

    const exploreMixed = makeTodo({ type: 'ExPlOrE' });
    expect(leafExecutionMode(exploreMixed)).toBe('explore');
  });

  it('returns verify for verify-typed leaves', () => {
    const verifyLeaf = makeTodo({ type: 'verify' });
    expect(leafExecutionMode(verifyLeaf)).toBe('verify');

    const cadDogfood = makeTodo({ type: 'cad-dogfood' });
    expect(leafExecutionMode(cadDogfood)).toBe('verify');

    const dogfood = makeTodo({ type: 'dogfood' });
    expect(leafExecutionMode(dogfood)).toBe('verify');
  });

  it('returns review for reviewer-typed leaves', () => {
    const reviewLeaf = makeTodo({ type: 'reviewer' });
    expect(leafExecutionMode(reviewLeaf)).toBe('review');

    const reviewCapital = makeTodo({ type: 'Reviewer' });
    expect(leafExecutionMode(reviewCapital)).toBe('review');
  });

  it('returns code for default/undefined type', () => {
    const defaultLeaf = makeTodo({ type: null });
    expect(leafExecutionMode(defaultLeaf)).toBe('code');

    const undefinedLeaf = makeTodo({});
    undefinedLeaf.type = undefined as any;
    expect(leafExecutionMode(undefinedLeaf)).toBe('code');

    const emptyType = makeTodo({ type: '' });
    expect(leafExecutionMode(emptyType)).toBe('code');
  });
});

describe('leafRunKinds: explore dispatch', () => {
  it('returns [explore, report] for an explore leaf', () => {
    const exploreLeaf = makeTodo({ type: 'explore' });
    const kinds = leafRunKinds(exploreLeaf);
    expect(kinds).toEqual(['explore', 'report']);
  });

  it('returns [driveplan, driveexec, report] for a verify leaf', () => {
    const verifyLeaf = makeTodo({ type: 'verify' });
    const kinds = leafRunKinds(verifyLeaf);
    expect(kinds).toEqual(['driveplan', 'driveexec', 'report']);
  });

  it('returns [review] for a review leaf', () => {
    const reviewLeaf = makeTodo({ type: 'reviewer' });
    const kinds = leafRunKinds(reviewLeaf);
    expect(kinds).toEqual(['review']);
  });

  it('returns [blueprint, implement, review] for a code leaf (default)', () => {
    const codeLeaf = makeTodo({ type: null });
    const kinds = leafRunKinds(codeLeaf);
    expect(kinds).toEqual(['blueprint', 'implement', 'review']);
  });
});

describe('exploreInflightBlocked: mutual exclusion gate', () => {
  it('returns false for non-explore leaves regardless of others inflight', () => {
    const codeLeaf = makeTodo({ type: null });
    const inflight: ClaimStruct = {
      by: 'daemon',
      token: 'tok-1',
      at: '2026-08-07T00:00:00Z',
      leaseMs: 300000,
    };
    const otherExplore = makeTodo({ type: 'explore', claim: inflight });
    const others = [otherExplore];

    expect(exploreInflightBlocked(codeLeaf, others)).toBe(false);
  });

  it('returns false for an explore leaf with no other explores inflight', () => {
    const exploreLeaf = makeTodo({ type: 'explore' });
    const codeLeaf = makeTodo({ type: null });
    const verifyLeaf = makeTodo({ type: 'verify' });
    const others = [codeLeaf, verifyLeaf];

    expect(exploreInflightBlocked(exploreLeaf, others)).toBe(false);
  });

  it('returns true for an explore leaf when another explore is inflight (claimed)', () => {
    const inflight: ClaimStruct = {
      by: 'daemon',
      token: 'tok-1',
      at: '2026-08-07T00:00:00Z',
      leaseMs: 300000,
    };
    const exploreA = makeTodo({ type: 'explore', claim: inflight });
    const exploreB = makeTodo({ type: 'explore', claim: null });
    const others = [exploreA];

    expect(exploreInflightBlocked(exploreB, others)).toBe(true);
  });

  it('ignores itself when checking for other explores', () => {
    const inflight: ClaimStruct = {
      by: 'daemon',
      token: 'tok-1',
      at: '2026-08-07T00:00:00Z',
      leaseMs: 300000,
    };
    const exploreLeaf = makeTodo({ type: 'explore', claim: inflight });
    const others = [exploreLeaf];

    expect(exploreInflightBlocked(exploreLeaf, others)).toBe(false);
  });
});

describe('claimReason: explore-inflight gate integration', () => {
  it('returns explore-inflight when a second explore leaf is blocked by an inflight explore', () => {
    const inflight: ClaimStruct = {
      by: 'daemon',
      token: 'tok-1',
      at: '2026-08-07T00:00:00Z',
      leaseMs: 300000,
    };
    const exploreA = makeTodo({
      id: 'explore-a',
      type: 'explore',
      claim: inflight,
      approvedAt: '2026-08-07T00:00:00Z',
      assigneeKind: 'agent',
      status: 'ready',
    });
    const exploreB = makeTodo({
      id: 'explore-b',
      type: 'explore',
      claim: null,
      approvedAt: '2026-08-07T00:00:00Z',
      assigneeKind: 'agent',
      status: 'ready',
    });

    const byId = new Map([
      [exploreA.id, exploreA],
      [exploreB.id, exploreB],
    ]);

    expect(claimReason(exploreB, byId)).toBe('explore-inflight');
  });

  it('returns claimable for an explore leaf once the inflight explore clears', () => {
    const inflight: ClaimStruct = {
      by: 'daemon',
      token: 'tok-1',
      at: '2026-08-07T00:00:00Z',
      leaseMs: 300000,
    };
    const exploreA = makeTodo({
      id: 'explore-a',
      type: 'explore',
      claim: inflight,
      approvedAt: '2026-08-07T00:00:00Z',
      assigneeKind: 'agent',
      status: 'ready',
    });
    const exploreB = makeTodo({
      id: 'explore-b',
      type: 'explore',
      claim: null,
      approvedAt: '2026-08-07T00:00:00Z',
      assigneeKind: 'agent',
      status: 'ready',
    });

    let byId = new Map([
      [exploreA.id, exploreA],
      [exploreB.id, exploreB],
    ]);

    // First, exploreB is blocked by exploreA's inflight claim
    expect(claimReason(exploreB, byId)).toBe('explore-inflight');

    // Clear exploreA's claim
    const exploreACleared = { ...exploreA, claim: null };
    byId = new Map([
      [exploreACleared.id, exploreACleared],
      [exploreB.id, exploreB],
    ]);

    // Now exploreB is claimable
    expect(claimReason(exploreB, byId)).toBe('claimable');
  });

  it('does not gate non-explore leaves even when an explore is inflight', () => {
    const inflight: ClaimStruct = {
      by: 'daemon',
      token: 'tok-1',
      at: '2026-08-07T00:00:00Z',
      leaseMs: 300000,
    };
    const exploreA = makeTodo({
      id: 'explore-a',
      type: 'explore',
      claim: inflight,
      approvedAt: '2026-08-07T00:00:00Z',
      status: 'ready',
    });
    const codeLeaf = makeTodo({
      id: 'code-leaf',
      type: null,
      approvedAt: '2026-08-07T00:00:00Z',
      status: 'ready',
    });

    const byId = new Map([
      [exploreA.id, exploreA],
      [codeLeaf.id, codeLeaf],
    ]);

    // The code leaf should not be gated by the inflight explore
    expect(claimReason(codeLeaf, byId)).toBe('claimable');
  });
});
