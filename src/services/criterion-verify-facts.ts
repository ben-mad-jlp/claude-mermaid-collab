/** Assemble live verify-stakes facts from the store with fail-safe reads.
 *  Each read is individually wrapped so a store throw degrades to the
 *  conservative zero value — never propagates, never fabricates a trigger. */

import { VerifyStakesInput } from './criterion-verify-stakes.ts';
import { missionIdOfCriterion, listCriteria, listPendingRechecks, listCriteriaWithActions } from './mission-store.ts';
import { listOpenEscalations } from './supervisor-store.ts';
import { trackingProjectRoot } from './project-registry.ts';

/** Safely call a function, returning the fallback on any throw. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Assemble the five inputs to classifyVerifyStakes from the live store,
 *  with fail-safe reads so any store throw degrades gracefully. */
export function collectVerifyStakesInput(project: string, criterionId: string): VerifyStakesInput {
  // reopenCount / lastReopenSha: resolve mission and find the criterion row.
  const missionId = safe(() => missionIdOfCriterion(project, criterionId), undefined);
  let reopenCount = 0;
  let lastReopenSha: string | null = null;
  if (missionId) {
    const criterion = safe(
      () => listCriteria(project, missionId).find((c) => c.id === criterionId),
      undefined,
    );
    if (criterion) {
      reopenCount = criterion.reopenCount;
      lastReopenSha = criterion.lastReopenSha;
    }
  }

  // pendingRecheckReason: look up the recheck queue.
  const pendingRecheckReason = safe(
    () => listPendingRechecks(project).find((r) => r.criterionId === criterionId)?.reason ?? null,
    null,
  );

  // servedEpicCount: resolve mission and find the criterion in the action view.
  let servedEpicCount = 0;
  if (missionId) {
    servedEpicCount = safe(
      () => listCriteriaWithActions(project, missionId).find((c) => c.id === criterionId)?.servedEpicCount ?? 0,
      0,
    );
  }

  // openCardKinds: filter escalations by project (normalize cwd) and criterion link.
  const openCardKinds = safe(() => {
    const project_root = trackingProjectRoot(project);
    return listOpenEscalations()
      .filter((e) => trackingProjectRoot(e.project) === project_root)
      .filter((e) => {
        // Criterion link: either todoId matches or conditionKey includes the criterion id.
        return e.todoId === criterionId || (e.conditionKey?.includes(criterionId) ?? false);
      })
      .map((e) => e.kind)
      .filter((k, i, arr) => arr.indexOf(k) === i); // deduplicate
  }, []);

  return {
    reopenCount,
    lastReopenSha,
    pendingRecheckReason,
    servedEpicCount,
    openCardKinds,
  };
}
