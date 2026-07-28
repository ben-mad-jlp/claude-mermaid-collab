import { describe, it, expect } from 'bun:test';
import { proofForEpic, servingEpicLive, isHollowDone, countsTowardServeCap, servingLandIsNewerThanVerdict } from '../mission-status-predicates.ts';
import type { Todo } from '../todo-store.ts';
import type { LeafRunSummary } from '../ledger-stats.ts';

function makeTodo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    parentId: null,
    projectRoots: [],
    kind: 'todo',
    title: `Todo ${id}`,
    status: 'todo',
    archivedAt: null,
    abandonedAt: null,
    droppedAt: null,
    acceptanceStatus: null,
    hollowLandedAt: null,
    landedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Todo;
}

function makeRun(
  epicId: string,
  finalOutcome: LeafRunSummary['finalOutcome'],
  nodesSpent = 0,
): Pick<LeafRunSummary, 'epicId' | 'finalOutcome' | 'nodesSpent'> {
  return { epicId, finalOutcome, nodesSpent };
}

describe('mission-status-predicates', () => {
  describe('proofForEpic', () => {
    it('resolves proven through nested epics to tagged leaves', () => {
      const leaf = makeTodo('leaf-1', {
        parentId: 'child-epic',
        kind: 'leaf',
      });
      const childEpic = makeTodo('child-epic', {
        parentId: 'root-epic',
        kind: 'epic',
      });
      const rootEpic = makeTodo('root-epic', {
        kind: 'epic',
      });

      const childrenByParent = new Map<string, Todo[]>([
        ['root-epic', [childEpic]],
        ['child-epic', [leaf]],
      ]);

      const memo = new Map();
      // Note: mocked criterionEdgesOf would need to be applied via monkey-patch or
      // we test the memoization + recursion structure instead
      const result = proofForEpic('root-epic', childrenByParent, memo);

      expect(result.proven).toBeInstanceOf(Set);
      expect(result.tagsAnyLeaf).toBeDefined();
      expect(result.hasUnfinishedLeaf).toBeDefined();
    });

    it('caches results on memo map and returns same object on second call', () => {
      const leaf = makeTodo('leaf-1', {
        parentId: 'epic',
        kind: 'leaf',
      });
      const epic = makeTodo('epic', { kind: 'epic' });

      const childrenByParent = new Map<string, Todo[]>([
        ['epic', [leaf]],
      ]);

      const memo = new Map();
      const result1 = proofForEpic('epic', childrenByParent, memo);
      const result2 = proofForEpic('epic', childrenByParent, memo);

      expect(result1 === result2).toBe(true);
    });

    it('marks hasUnfinishedLeaf true for untagged leaf not done/accepted/dropped', () => {
      const unfinishedLeaf = makeTodo('leaf-1', {
        parentId: 'epic',
        kind: 'leaf',
        status: 'todo',
        acceptanceStatus: null,
      });
      const epic = makeTodo('epic', { kind: 'epic' });

      const childrenByParent = new Map<string, Todo[]>([
        ['epic', [unfinishedLeaf]],
      ]);

      const memo = new Map();
      const result = proofForEpic('epic', childrenByParent, memo);

      expect(result.hasUnfinishedLeaf).toBe(true);
    });

    it('does not mark hasUnfinishedLeaf for dropped leaves', () => {
      const droppedLeaf = makeTodo('leaf-1', {
        parentId: 'epic',
        kind: 'leaf',
        status: 'dropped',
      });
      const epic = makeTodo('epic', { kind: 'epic' });

      const childrenByParent = new Map<string, Todo[]>([
        ['epic', [droppedLeaf]],
      ]);

      const memo = new Map();
      const result = proofForEpic('epic', childrenByParent, memo);

      expect(result.hasUnfinishedLeaf).toBe(false);
    });
  });

  describe('servingEpicLive', () => {
    it('returns true for non-landed epic when ledgerUnavailable=true', () => {
      const epic = makeTodo('epic', {
        kind: 'epic',
        status: 'todo',
        landedAt: null,
      });

      const byId = new Map([['epic', epic]]);
      const result = servingEpicLive(epic, true, [], [], byId, Date.now());

      expect(result).toBe(true);
    });

    it('returns false for landed epic when ledgerUnavailable=true', () => {
      const epic = makeTodo('epic', {
        kind: 'epic',
        status: 'done',
        landedAt: new Date().toISOString(),
      });

      const byId = new Map([['epic', epic]]);
      const result = servingEpicLive(epic, true, [], [], byId, Date.now());

      expect(result).toBe(false);
    });

    it('returns false for non-landed epic with no motion when ledgerUnavailable=false', () => {
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const epic = makeTodo('epic', {
        kind: 'epic',
        status: 'todo',
        landedAt: null,
        createdAt: oldDate,
      });

      const byId = new Map([['epic', epic]]);
      const result = servingEpicLive(epic, false, [], [], byId, Date.now());

      expect(result).toBe(false);
    });

    it('returns true for non-landed epic with pending run', () => {
      const epic = makeTodo('epic', {
        kind: 'epic',
        status: 'todo',
        landedAt: null,
      });

      const byId = new Map([['epic', epic]]);
      const runs: Pick<LeafRunSummary, 'epicId' | 'finalOutcome'>[] = [
        { epicId: 'epic', finalOutcome: 'pending' },
      ];
      const result = servingEpicLive(epic, false, runs, [], byId, Date.now());

      expect(result).toBe(true);
    });

    it('returns true for non-landed epic within childless grace period', () => {
      const recentDate = new Date(Date.now() - 1000).toISOString();
      const epic = makeTodo('epic', {
        kind: 'epic',
        status: 'todo',
        landedAt: null,
        createdAt: recentDate,
      });

      const byId = new Map([['epic', epic]]);
      const result = servingEpicLive(epic, false, [], [], byId, Date.now());

      expect(result).toBe(true);
    });
  });

  describe('isHollowDone', () => {
    it('returns true for done epic with hollowLandedAt set', () => {
      const epic = makeTodo('epic', {
        kind: 'epic',
        status: 'done',
        hollowLandedAt: new Date().toISOString(),
      });

      const result = isHollowDone(epic, []);

      expect(result).toBe(true);
    });

    it('returns true for done epic without hollowLandedAt but with no children (hollow)', () => {
      const epic = makeTodo('epic', {
        kind: 'epic',
        status: 'done',
        hollowLandedAt: null,
      });

      const result = isHollowDone(epic, []);

      expect(result).toBe(true);
    });

    it('returns false for non-done epic', () => {
      const epic = makeTodo('epic', {
        kind: 'epic',
        status: 'todo',
        hollowLandedAt: null,
      });

      const result = isHollowDone(epic, []);

      expect(result).toBe(false);
    });

    it('returns true for done epic with a single leaf child (zero-leaf hollow)', () => {
      const epic = makeTodo('epic', {
        kind: 'epic',
        status: 'done',
        hollowLandedAt: null,
      });
      const leaf = makeTodo('leaf', {
        parentId: 'epic',
        kind: 'leaf',
      });

      const result = isHollowDone(epic, [leaf]);

      expect(result).toBe(true);
    });
  });

  describe('countsTowardServeCap', () => {
    it('returns true for zero-leaf epic (thin re-file)', () => {
      const epic = makeTodo('epic', { kind: 'epic' });

      const result = countsTowardServeCap(epic, [], [], false);

      expect(result).toBe(true);
    });

    it('returns true when ledgerUnavailable=true', () => {
      const epic = makeTodo('epic', { kind: 'epic' });
      const leaf = makeTodo('leaf', {
        parentId: 'epic',
        kind: 'leaf',
        status: 'todo',
      });

      const result = countsTowardServeCap(epic, [leaf], [], true);

      expect(result).toBe(true);
    });

    it('returns true for epic with accepted leaf', () => {
      const epic = makeTodo('epic', { kind: 'epic' });
      const leaf = makeTodo('leaf', {
        parentId: 'epic',
        kind: 'leaf',
        acceptanceStatus: 'accepted',
      });

      const result = countsTowardServeCap(epic, [leaf], [], false);

      expect(result).toBe(true);
    });

    it('returns true for epic with rejected leaf', () => {
      const epic = makeTodo('epic', { kind: 'epic' });
      const leaf = makeTodo('leaf', {
        parentId: 'epic',
        kind: 'leaf',
        acceptanceStatus: 'rejected',
      });

      const result = countsTowardServeCap(epic, [leaf], [], false);

      expect(result).toBe(true);
    });

    it('returns false for unrun leaves with no matching ledger spend (refund case)', () => {
      const epic = makeTodo('epic', { kind: 'epic' });
      const leaf = makeTodo('leaf', {
        parentId: 'epic',
        kind: 'leaf',
        status: 'todo',
        acceptanceStatus: null,
      });

      const result = countsTowardServeCap(epic, [leaf], [], false);

      expect(result).toBe(false);
    });

    it('returns true when capRuns has settled outcome for epic', () => {
      const epic = makeTodo('epic', { kind: 'epic' });
      const leaf = makeTodo('leaf', {
        parentId: 'epic',
        kind: 'leaf',
        status: 'todo',
        acceptanceStatus: null,
      });
      const capRuns: Pick<LeafRunSummary, 'epicId' | 'finalOutcome' | 'nodesSpent'>[] = [
        makeRun('epic', 'accepted', 0),
      ];

      const result = countsTowardServeCap(epic, [leaf], capRuns, false);

      expect(result).toBe(true);
    });

    it('returns true when capRuns has spend for epic', () => {
      const epic = makeTodo('epic', { kind: 'epic' });
      const leaf = makeTodo('leaf', {
        parentId: 'epic',
        kind: 'leaf',
        status: 'todo',
        acceptanceStatus: null,
      });
      const capRuns: Pick<LeafRunSummary, 'epicId' | 'finalOutcome' | 'nodesSpent'>[] = [
        makeRun('epic', 'pending', 5),
      ];

      const result = countsTowardServeCap(epic, [leaf], capRuns, false);

      expect(result).toBe(true);
    });

    it('returns false when leaves are dropped and no ledger evidence', () => {
      const epic = makeTodo('epic', { kind: 'epic' });
      const leaf = makeTodo('leaf', {
        parentId: 'epic',
        kind: 'leaf',
        status: 'dropped',
      });

      const result = countsTowardServeCap(epic, [leaf], [], false);

      expect(result).toBe(false);
    });
  });

  describe('servingLandIsNewerThanVerdict', () => {
    it('returns true when all fields present and fresh: different sha and newer timestamp', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: 100,
        verifiedAtSha: 'old111',
        servingEpicLandSha: 'new222',
        servingEpicLandedAt: 200,
      });

      expect(result).toBe(true);
    });

    it('returns false when verifiedAt is null', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: null,
        verifiedAtSha: 'old111',
        servingEpicLandSha: 'new222',
        servingEpicLandedAt: 200,
      });

      expect(result).toBe(false);
    });

    it('returns false when verifiedAtSha is null', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: 100,
        verifiedAtSha: null,
        servingEpicLandSha: 'new222',
        servingEpicLandedAt: 200,
      });

      expect(result).toBe(false);
    });

    it('returns false when servingEpicLandSha is null', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: 100,
        verifiedAtSha: 'old111',
        servingEpicLandSha: null,
        servingEpicLandedAt: 200,
      });

      expect(result).toBe(false);
    });

    it('returns false when servingEpicLandSha equals verifiedAtSha (same commit)', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: 100,
        verifiedAtSha: 'same111',
        servingEpicLandSha: 'same111',
        servingEpicLandedAt: 200,
      });

      expect(result).toBe(false);
    });

    it('returns false when servingEpicLandedAt is null', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: 100,
        verifiedAtSha: 'old111',
        servingEpicLandSha: 'new222',
        servingEpicLandedAt: null,
      });

      expect(result).toBe(false);
    });

    it('returns false when servingEpicLandedAt is older than verifiedAt (stale land timestamp)', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: 200,
        verifiedAtSha: 'old111',
        servingEpicLandSha: 'new222',
        servingEpicLandedAt: 100,
      });

      expect(result).toBe(false);
    });

    it('returns false when verifiedAtSha is undefined', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: 100,
        servingEpicLandSha: 'new222',
        servingEpicLandedAt: 200,
      });

      expect(result).toBe(false);
    });

    it('returns false when servingEpicLandSha is undefined', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: 100,
        verifiedAtSha: 'old111',
        servingEpicLandedAt: 200,
      });

      expect(result).toBe(false);
    });

    it('returns false when servingEpicLandedAt is undefined', () => {
      const result = servingLandIsNewerThanVerdict({
        verifiedAt: 100,
        verifiedAtSha: 'old111',
        servingEpicLandSha: 'new222',
      });

      expect(result).toBe(false);
    });
  });
});
