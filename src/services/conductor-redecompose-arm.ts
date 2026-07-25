/**
 * conductor-redecompose-arm — the conductor's CHURN-DECOMPOSE arm for criteria stuck in
 * rejection loops.
 *
 * A serving epic whose leaves are repeatedly rejected (churning: rejectedCount + blockedCount
 * >= EPIC_CHURN_REJECT_THRESHOLD with zero acceptedCount) is spinning its wheels. The arm
 * drops it and re-plans the criterion with a tighter decomposition hint to break the loop.
 *
 * Order is load-bearing: recordApproachAttempt → drop → plan, so a crash between drop and
 * plan cannot re-fire the rung on the next tick. And plan must follow drop or every
 * re-serve throws ServeIntegrityError (assertServeIntegrity + findServingEpic both skip
 * dropped status).
 *
 * Fail OPEN: each criterion in its own try/catch — one bad probe or card-store hiccup must
 * never sink the conductor pass. A criterion that has already attempted re-decompose is
 * short-circuited by the ladder store and never fired again (one per criterion ever).
 */
import { listCriteriaWithActions } from './mission-store.js';
import { listTodos, updateTodo, type Todo } from './todo-store.js';
import { isEpic } from './todo-kind.js';
import { listLeafRuns } from './ledger-stats.js';
import { detectEpicChurn, buildTighterDecompositionHint } from './epic-churn.js';
import { hasAttemptedRung, recordApproachAttempt } from './criterion-approach-store.js';

export type RedecomposeSkipReason =
  | 'no-serving-epic'
  | 'not-churning'
  | 'rung-already-attempted'
  | 'record-failed'
  | 'drop-failed'
  | 'plan-failed';

export interface RedecomposeArmDeps {
  listCriteriaWithActions?: typeof listCriteriaWithActions;
  listTodos?: typeof listTodos;
  listLeafRuns?: typeof listLeafRuns;
  hasAttemptedRung?: typeof hasAttemptedRung;
  recordApproachAttempt?: typeof recordApproachAttempt;
  updateTodo?: typeof updateTodo;
  planMissionCriterion?: (project: string, opts: any) => Promise<any>;
  now?: () => number;
}

export interface RedecomposeArmResult {
  redecomposed: string[];
  skipped: Array<{
    criterionId: string;
    why: RedecomposeSkipReason;
  }>;
}

/**
 * Find the newest serving epic for a criterion that is not dropped and not done.
 * Matches on servesCriterionId or servesCriterionIds array.
 */
export function findServingEpicForCriterion(
  todos: Todo[],
  missionId: string,
  criterionId: string,
): Todo | undefined {
  const candidates = todos.filter(
    (t) =>
      isEpic(t) &&
      t.parentId === missionId &&
      t.status !== 'dropped' &&
      t.status !== 'done' &&
      (t.servesCriterionId === criterionId ||
        (t.servesCriterionIds ?? []).includes(criterionId)),
  );

  if (candidates.length === 0) return undefined;
  // Newest by createdAt (ISO string comparison works for timestamps)
  return candidates.reduce((newest, current) =>
    current.createdAt > newest.createdAt ? current : newest,
  );
}

/**
 * Run the arm for one mission: detect criteria stuck in rejection loops and
 * re-plan them with tighter decomposition hints.
 */
export async function runRedecomposeArm(
  project: string,
  missionId: string,
  session: string,
  deps: RedecomposeArmDeps = {},
): Promise<RedecomposeArmResult> {
  const listCriteriaFn = deps.listCriteriaWithActions ?? listCriteriaWithActions;
  const listTodosFn = deps.listTodos ?? listTodos;
  const listLeafRunsFn = deps.listLeafRuns ?? listLeafRuns;
  const hasAttemptedFn = deps.hasAttemptedRung ?? hasAttemptedRung;
  const recordAttemptFn = deps.recordApproachAttempt ?? recordApproachAttempt;
  const updateTodoFn = deps.updateTodo ?? updateTodo;
  const planFn = deps.planMissionCriterion ?? (async () => {
    const { planMissionCriterion: plan } = await import('../mcp/tools/mission-planner.js');
    return plan;
  });
  const nowFn = deps.now ?? (() => Date.now());

  const result: RedecomposeArmResult = { redecomposed: [], skipped: [] };

  let criteria: ReturnType<typeof listCriteriaFn>;
  try {
    criteria = listCriteriaFn(project, missionId);
  } catch {
    return result; // fail-open
  }

  // Filter to criteria with action 'building' or 'discover'
  const actionable = criteria.filter(
    (c) => c.action === 'building' || c.action === 'discover',
  );

  // Fetch all todos once outside the loop
  let todos: Todo[];
  try {
    todos = listTodosFn(project, { includeCompleted: true });
  } catch {
    return result; // fail-open
  }

  for (const criterion of actionable) {
    try {
      // 1. Find the serving epic
      const epic = findServingEpicForCriterion(todos, missionId, criterion.id);
      if (!epic) {
        result.skipped.push({ criterionId: criterion.id, why: 'no-serving-epic' });
        continue;
      }

      // 2. Check for churn via leaf runs
      let runs: ReturnType<typeof listLeafRunsFn>;
      try {
        runs = listLeafRunsFn({ project, epicId: epic.id });
      } catch {
        runs = []; // fail-open
      }

      const churn = detectEpicChurn({ runs });
      if (!churn.churning) {
        result.skipped.push({ criterionId: criterion.id, why: 'not-churning' });
        continue;
      }

      // 3. Check if rung already attempted
      if (hasAttemptedFn(project, criterion.id, 're-decompose')) {
        result.skipped.push({
          criterionId: criterion.id,
          why: 'rung-already-attempted',
        });
        continue;
      }

      // 4. Record the attempt BEFORE dropping
      const priorLeafCount = todos.filter((t) => t.parentId === epic.id && !isEpic(t))
        .length;
      const distinctReasons = churn.distinctReasons.join('; ');
      const detail = `churning: ${churn.rejectedCount} rejected, 0 accepted (was ${priorLeafCount} leaves); reasons: ${distinctReasons}`;

      const recordOk = recordAttemptFn({
        criterionId: criterion.id,
        missionId,
        project,
        rung: 're-decompose',
        epicId: epic.id,
        outcome: 'attempted',
        detail,
        attemptedAt: nowFn(),
      });

      if (!recordOk) {
        result.skipped.push({ criterionId: criterion.id, why: 'record-failed' });
        continue;
      }

      // 5. Drop the epic
      try {
        await updateTodoFn(project, epic.id, { status: 'dropped' });
      } catch {
        result.skipped.push({ criterionId: criterion.id, why: 'drop-failed' });
        continue;
      }

      // 6. Plan with tighter decomposition hint
      try {
        const plan = typeof planFn === 'function'
          ? planFn
          : (await planFn);

        await plan(project, {
          session,
          missionId,
          criterionIds: [criterion.id],
          decompositionHint: buildTighterDecompositionHint({
            priorEpicTitle: epic.title,
            priorLeafCount,
            distinctReasons: churn.distinctReasons,
          }),
        });
      } catch {
        result.skipped.push({ criterionId: criterion.id, why: 'plan-failed' });
        continue;
      }

      // 7. Success: push to redecomposed
      result.redecomposed.push(criterion.id);
    } catch {
      // Fail-open per criterion — one bad iteration must not sink the arm
    }
  }

  return result;
}
