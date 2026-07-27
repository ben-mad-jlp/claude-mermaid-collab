/**
 * Pure predicates lifted from collectMissionStatusFacts (mission-store.ts).
 * These functions take pre-built indexes as parameters and have no internal
 * listTodos/listLeafRuns calls.
 */
import { isEpic } from './todo-kind.ts';
import { criterionEdgesOf } from './criterion-edges.ts';
import { isLanded } from './epic-landedness.ts';
import { derivedStatus } from './claimability.ts';
import { isHollowLand } from './todo-store.ts';
import { CHILDLESS_SERVE_GRACE_MS } from './harness-caps.ts';
import type { Todo } from './todo-store.ts';
import type { LeafRunSummary } from './ledger-stats.ts';

/**
 * Proof-aware land check: a landed epic must prove a criterion (a delivered
 * descendant leaf carries this criterion's id) OR the epic tags no leaf at all
 * AND every descendant leaf has settled (legacy fallback).
 *
 * Memoized by the caller's proofByEpic map.
 */
export function proofForEpic(
  epicId: string,
  childrenByParent: Map<string, Todo[]>,
  memo: Map<string, { proven: Set<string>; tagsAnyLeaf: boolean; hasUnfinishedLeaf: boolean }>,
): { proven: Set<string>; tagsAnyLeaf: boolean; hasUnfinishedLeaf: boolean } {
  const hit = memo.get(epicId);
  if (hit) return hit;
  const proven = new Set<string>();
  let tagsAnyLeaf = false;
  let hasUnfinishedLeaf = false;
  const walk = (parentId: string) => {
    for (const t of childrenByParent.get(parentId) ?? []) {
      if (!isEpic(t)) {
        const tags = criterionEdgesOf(t);
        if (tags.length > 0) {
          tagsAnyLeaf = true;
          if (t.status === 'done' && t.acceptanceStatus !== 'rejected') tags.forEach((id) => proven.add(id));
        }
        if (t.status !== 'dropped' && t.status !== 'done' && t.acceptanceStatus !== 'accepted') {
          hasUnfinishedLeaf = true;
        }
      }
      walk(t.id);
    }
  };
  walk(epicId);
  const res = { proven, tagsAnyLeaf, hasUnfinishedLeaf };
  memo.set(epicId, res);
  return res;
}

/**
 * Criterion liveness: does this serving epic have actual motion?
 * A filed-but-unapproved epic is NOT live — its criterion stays 'discover'.
 *
 * ledgerUnavailable: treat any open serving epic as live (fail toward LIVE).
 */
export function servingEpicLive(
  e: Todo,
  ledgerUnavailable: boolean,
  runs: readonly Pick<LeafRunSummary, 'epicId' | 'finalOutcome'>[],
  allTodos: readonly Todo[],
  byId: Map<string, Todo>,
  now: number,
): boolean {
  if (ledgerUnavailable) {
    return !isLanded(e);
  }
  return (
    !isLanded(e) && (
      runs.some((r) => r.epicId === e.id && (r.finalOutcome === 'pending' || r.finalOutcome === 'paused')) ||
      allTodos.some((t) => t.parentId === e.id && !isEpic(t) &&
        (derivedStatus(t, byId) === 'ready' || derivedStatus(t, byId) === 'in_progress')) ||
      (!allTodos.some((t) => t.parentId === e.id && !isEpic(t)) && Number.isFinite(Date.parse(e.createdAt)) &&
        now - Date.parse(e.createdAt) < CHILDLESS_SERVE_GRACE_MS)
    )
  );
}

/**
 * A hollow-landed done epic doesn't burn the serve cap (LS-1).
 */
export function isHollowDone(e: Todo, allTodos: readonly Todo[]): boolean {
  return e.status === 'done' && (
    e.hollowLandedAt != null ||
    isHollowLand(e, allTodos.filter((t) => t.parentId === e.id && !isEpic(t)))
  );
}

/**
 * Serve-cap refund: does this epic count toward the anti-thrash cap?
 * An epic counts iff it made a genuine attempt (has no leaf children, OR has a
 * settled leaf, OR a node actually spent under it).
 */
export function countsTowardServeCap(
  e: Todo,
  allTodos: readonly Todo[],
  capRuns: readonly Pick<LeafRunSummary, 'epicId' | 'finalOutcome' | 'nodesSpent'>[],
  ledgerUnavailable: boolean,
): boolean {
  const leaves = allTodos.filter((t) => t.parentId === e.id && !isEpic(t));
  if (leaves.length === 0) return true;
  if (ledgerUnavailable) return true;
  if (leaves.some((t) => t.acceptanceStatus === 'accepted' || t.acceptanceStatus === 'rejected')) return true;
  return capRuns.some((r) => r.epicId === e.id && (
    r.finalOutcome === 'accepted' || r.finalOutcome === 'rejected' || (r.nodesSpent ?? 0) > 0
  ));
}
