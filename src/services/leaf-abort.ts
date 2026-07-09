/**
 * Cooperative abort predicate for the leaf-executor (kill-the-running-build epic).
 *
 * A hard kill of the node subprocess alone is not sufficient — `runLeaf` just sees a
 * non-zero node result and spawns the NEXT node. `abortReasonFor` is the pure decision
 * ("should this run stop?"); `leafAbortReason` is the live wrapper (reads todo-store)
 * used both as the executor's `shouldAbort` dep and by the E1 orphan-reaper.
 */

import { getTodo, type Todo } from './todo-store';

export type AbortReason = 'gone' | 'dropped' | 'held' | 'claim-lost' | null;

/** Pure: should the run that launched with `launchToken` stop? */
export function abortReasonFor(opts: {
  todo: Pick<Todo, 'status' | 'heldAt' | 'claimToken'> | null | undefined;
  launchToken: string | null;
}): AbortReason {
  if (!opts.todo) return 'gone';
  if (opts.todo.status === 'dropped') return 'dropped';
  if (opts.todo.heldAt != null) return 'held';
  // Claim released/re-minted under us → this run no longer owns the leaf.
  // A null launchToken (tests / legacy dispatch) opts OUT of the claim check.
  if (opts.launchToken && opts.todo.claimToken !== opts.launchToken) return 'claim-lost';
  return null;
}

/** Live wrapper: reads todo-store. Used as the executor's `shouldAbort` dep and by E1. */
export function leafAbortReason(project: string, leafId: string, launchToken: string | null): AbortReason {
  return abortReasonFor({ todo: getTodo(project, leafId), launchToken });
}

/** Thrown by the executor's node-boundary abort check to unwind straight to `finishWith`
 *  without touching `complete`/`markRejecting`/`escalate`/`mergeToEpic` — the aborter
 *  (drop cascade / claim release) already decided the todo's terminal state. */
export class LeafAborted extends Error {
  constructor(readonly abortReason: AbortReason) {
    super(`leaf-aborted: ${abortReason}`);
    this.name = 'LeafAborted';
  }
}
