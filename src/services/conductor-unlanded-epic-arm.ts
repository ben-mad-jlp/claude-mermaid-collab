/**
 * conductor-unlanded-epic-arm — detect done-but-unlanded serving epics and arm the LAND path.
 *
 * When a criterion's only serving epic is finished (status='done' or landedAt set) but never
 * merged, the criterion derives `discover` (no live serving epic). The conductor would then
 * file a SECOND epic to rebuild work that already exists on a branch. This arm detects that
 * state and mints a LAND card for the existing epic — zero node spend, same authorized landing
 * path the human Land button drives — and excludes the criterion from the conductor's serve list.
 *
 * Fail OPEN, per epic and outermost: a throw handling one epic lands it in `skipped`;
 * a fault reading the store (or any unexpected throw) at the top level yields
 * `{ carded: [], skipped: [] }`, matching conductor-verify-panel-arm.ts's discipline.
 */
import { listCriteriaWithActions } from './mission-store.js';
import { listTodos, getTodo, type Todo } from './todo-store.js';
import { listOpenEscalations, createEscalation, type Escalation } from './supervisor-store.js';
import { LAND_CARD_KIND } from './conductor-signature.js';
import { isEpicStatusDone, hasLandStamp, isEpicLandedInGit, detectTrunkBranch, type GitLandStatus } from './epic-landedness.js';
import { todoServesCriterion } from './criterion-edges.js';

export const UNLANDED_DONE_EPIC_PREFIX = 'unlanded-done-epic';

export function unlandedDoneEpicConditionKey(epicId: string): string {
  return `${UNLANDED_DONE_EPIC_PREFIX}:${epicId}`;
}

export interface UnlandedEpicArmDeps {
  listCriteriaWithActions?: typeof listCriteriaWithActions;
  listTodos?: typeof listTodos;
  isEpicLandedInGit?: typeof isEpicLandedInGit;
  detectTrunkBranch?: typeof detectTrunkBranch;
  listOpenEscalations?: typeof listOpenEscalations;
  createEscalation?: typeof createEscalation;
}

export interface UnlandedEpicArmResult {
  carded: string[];
  skipped: string[];
  /** Criterion ids served by epics that were armed (for hasGap filtering). */
  criterionIds: string[];
}

/**
 * Find criteria that derive `discover` or `verify` but whose only settled serving epic probes as 'not-landed'.
 *
 * @returns Array of { criterionId, epicId } pairs. Deduped by epicId for the git probe
 * (each epic probed at most once) but one row per criterion so the caller can build its
 * armed-criterion-id set.
 */
export async function findUnlandedDoneServingEpics(
  project: string,
  missionId: string,
  deps?: UnlandedEpicArmDeps,
): Promise<{ criterionId: string; epicId: string }[]> {
  const listCriteria = deps?.listCriteriaWithActions ?? listCriteriaWithActions;
  const listTodosImpl = deps?.listTodos ?? listTodos;
  const isLandedGit = deps?.isEpicLandedInGit ?? isEpicLandedInGit;
  const detectTrunk = deps?.detectTrunkBranch ?? detectTrunkBranch;

  // 1. List criteria with actions; keep `action === 'discover' || 'verify'` with a done serving epic.
  const criteriaWithActions = listCriteria(project, missionId);
  // A settled but unlanded epic can derive discover or verify depending on other facts.
  // We arm both to catch the case where a done epic serves a verify criterion.
  const candidateCriteria = criteriaWithActions.filter((c) => c.action === 'discover' || c.action === 'verify');
  if (candidateCriteria.length === 0) return [];

  // 2. One `listTodos` call for the whole scan.
  const allTodos = listTodosImpl(project, { includeCompleted: true });

  // 3. Resolve the trunk ONCE per call.
  let trunk: string | undefined;
  try {
    trunk = await detectTrunk(project);
  } catch {
    trunk = undefined;
  }

  // 4. Build a map of todos by id for quick lookup.
  const byId = new Map<string, Todo>();
  for (const t of allTodos) byId.set(t.id, t);

  const results: { criterionId: string; epicId: string }[] = [];
  const probedEpics = new Set<string>(); // Dedup the git probe

  for (const criterion of candidateCriteria) {
    // Find candidate epics: t.parentId === missionId && t.kind === 'epic' && !dropped && serves criterion
    const candidates = allTodos.filter(
      (t) => t.parentId === missionId && t.kind === 'epic' && t.status !== 'dropped' && todoServesCriterion(t, criterion.id),
    );

    // 3. Settled filter: `isEpicStatusDone(epic) || hasLandStamp(epic)`.
    const settled = candidates.filter((e) => isEpicStatusDone(e) || hasLandStamp(e));
    if (settled.length === 0) continue;

    // There should be at most one per criterion, but handle multiples defensively.
    for (const epic of settled) {
      if (probedEpics.has(epic.id)) {
        // Already probed this epic; skip the git probe but emit the result.
        results.push({ criterionId: criterion.id, epicId: epic.id });
        continue;
      }

      probedEpics.add(epic.id);

      // 5. Probe `isEpicLandedInGit`. Qualify ONLY on 'not-landed'.
      let probeResult: GitLandStatus;
      try {
        probeResult = await isLandedGit(project, epic.id, { trunk });
      } catch {
        // Fault: fail-CLOSED, skip this epic.
        probeResult = 'indeterminate';
      }

      if (probeResult === 'not-landed') {
        results.push({ criterionId: criterion.id, epicId: epic.id });
      }
    }
  }

  return results;
}

/**
 * Run the unlanded-epic arm: call the detector, then mint one LAND card per qualifying epic.
 *
 * @param project — The project tracking root.
 * @param missionId — The mission to scan for done-but-unlanded serving epics.
 * @param session — The conductor session, used as the card raiser identity.
 * @param deps — Injectable IO. All default to live implementations.
 * @returns { carded, skipped, criterionIds } — epic ids bucketed by outcome + armed criterion ids.
 */
export async function runUnlandedEpicLandArm(
  project: string,
  missionId: string,
  session: string,
  deps?: UnlandedEpicArmDeps,
): Promise<UnlandedEpicArmResult> {
  const carded: string[] = [];
  const skipped: string[] = [];
  const criterionIds: string[] = [];

  try {
    const results = await findUnlandedDoneServingEpics(project, missionId, deps);

    // Extract unique criterion ids.
    const uniqueCriterionIds = [...new Set(results.map((r) => r.criterionId))];
    criterionIds.push(...uniqueCriterionIds);

    // Dedup by epicId — emit each epic id only once.
    const uniqueEpics = [...new Map(results.map((r) => [r.epicId, r])).values()];

    const listOpen = deps?.listOpenEscalations ?? listOpenEscalations;
    const createEsc = deps?.createEscalation ?? createEscalation;

    for (const { epicId } of uniqueEpics) {
      try {
        // Dedup shape: skip if an open card with this key already exists.
        const conditionKey = unlandedDoneEpicConditionKey(epicId);
        const existingCard = listOpen().some((e) => e.conditionKey === conditionKey && e.status === 'open');
        if (existingCard) {
          skipped.push(epicId);
          continue;
        }

        // Mint the card.
        createEsc({
          project,
          session,
          kind: LAND_CARD_KIND,
          todoId: epicId,
          operatorGated: true,
          audience: 'human',
          conditionKey,
          conditionTuple: [UNLANDED_DONE_EPIC_PREFIX, epicId],
          questionText: `Epic ${epicId} is done but not yet landed — an unlanded serving epic ` +
            `deriving 'discover' on its criterion. Landing this epic via the deterministic path ` +
            `instead of filing a duplicate.`,
        });

        carded.push(epicId);
      } catch {
        // Fail-open per epic.
        skipped.push(epicId);
      }
    }

    return { carded, skipped, criterionIds };
  } catch {
    // Fail-open outermost.
    return { carded: [], skipped: [], criterionIds: [] };
  }
}
