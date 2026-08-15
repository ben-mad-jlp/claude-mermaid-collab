/**
 * repair-mission-pass.ts — Deterministic pass to forge repair missions from batched bugfix requests.
 *
 * Runs on a throttled interval per project. Reads open bugfix-bucket leaves, selects a batch
 * when the size/age bar is met, and forges an UNAPPROVED repair mission with exactly one
 * human-actionable approval card. No LLM; the forge machinery (forgeMission) is the only
 * spend, and it is reached only after deterministic batch selection commits to work.
 *
 * Cap: at most ONE open repair mission per project at a time (refusals when one exists,
 * never overlapping auto-forged work on the same account).
 */

import { REPAIR_FORGE_SESSION, isAutoForgedRepairMission, REPAIR_BATCH_K, REPAIR_AGE_MS, REPAIR_BUDGET_USD, selectRepairBatch, repairBatchTrigger, buildRepairMissionSpec, type RepairRequest, type RepairBatchItem } from './repair-mission-forge.js';
import { ensureBucket } from './bucket-registry.js';
import { isBucketItem, reopenConsumedFor, consumerDelivered } from './bucket-consumption.js';
import { listTodos, getTodo, type Todo } from './todo-store.js';
import { listMissions, listCriteria, isMissionTerminal, getMission, setMissionAbandoned, type MissionSummary } from './mission-store.js';
import { forgeMission, approveMissionAndConstitution, type ForgeMissionInput } from '../mcp/tools/mission-forge.js';
import { createEscalation, listOpenEscalations, type EscalationOption } from './supervisor-store.js';
import { recordAutoAction } from './auto-action-audit.js';
import { getConfig } from './config-service.js';

export const REPAIR_MISSION_APPROVAL_KIND = 'repair-mission-approval';

/** Minimum spacing between repair-forge passes for a single project. */
export const REPAIR_FORGE_INTERVAL_MS = 300_000; // 5 min

/** Threshold for detecting a stale unapproved repair mission: 1 hour. */
export const REPAIR_APPROVAL_STALE_MS = 3_600_000;

const lastRepairForgeMs = new Map<string, number>();

/**
 * Throttle gate for runRepairForgePass. Returns true (and records `now` as the last
 * run) when the pass is due for `project`; false while a previous run is within
 * REPAIR_FORGE_INTERVAL_MS. First call for a project always runs. `now` is injectable
 * for deterministic tests.
 */
export function shouldRunRepairForgePass(project: string, now: number = Date.now()): boolean {
  const last = lastRepairForgeMs.get(project);
  if (last !== undefined && now - last < REPAIR_FORGE_INTERVAL_MS) return false;
  lastRepairForgeMs.set(project, now);
  return true;
}

/** Test seam: clear the per-project throttle clock (all projects, or one). */
export function _resetRepairForgeThrottle(project?: string): void {
  if (project === undefined) lastRepairForgeMs.clear();
  else lastRepairForgeMs.delete(project);
}

/**
 * Pure detector: returns missions that are awaiting approval and have exceeded the stale threshold.
 * Filters out terminal missions. No DB access; all inputs are injected.
 */
export function missionsAwaitingApprovalPastThreshold(
  missions: MissionSummary[],
  opts: { thresholdMs?: number; now?: number } = {},
): MissionSummary[] {
  const thresholdMs = opts.thresholdMs ?? REPAIR_APPROVAL_STALE_MS;
  const now = opts.now ?? Date.now();

  return missions.filter((m) => {
    if (isMissionTerminal(m.mission)) return false;
    if (m.mission.awaitingApprovalSince == null) return false;
    return now - m.mission.awaitingApprovalSince > thresholdMs;
  });
}

export interface RepairForgeDeps {
  /** Read todos for a project. Default: listTodos. */
  listTodos?: (project: string) => Todo[];
  /** Optional todos snapshot (audit item 7a). Passed by the orchestrator tick. */
  todosSnapshot?: Todo[];
  /** Resolve/ensure a bucket by kind. Default: ensureBucket. */
  ensureBucket?: (project: string, kind: string) => string;
  /** Check if a todo is a bucket item. Default: isBucketItem. */
  isBucketItem?: (project: string, todoId: string) => boolean;
  /** List missions in a project. Default: listMissions. */
  listMissions?: (project: string, allTodos?: Todo[]) => MissionSummary[];
  /** Forge a mission from input spec. Default: forgeMission.
   *  The resolved value carries the forge's accounting (optional for test fakes):
   *  - missionId: the created mission id (required)
   *  - criteria?: array of created criteria (optional, used for result counts)
   *  - consumedBucketItems?: { consumed: string[] } (optional, used for consumption accounting)
   */
  forge?: (project: string, input: ForgeMissionInput) => Promise<{ missionId: string; criteria?: unknown[]; consumedBucketItems?: { consumed: string[] } }>;
  /** Create an escalation card. Default: createEscalation. Must be injectable for tests (throws on tmp paths). */
  createEscalation?: (input: Parameters<typeof createEscalation>[0]) => ReturnType<typeof createEscalation>;
  /** Record auto-action audit events. Default: recordAutoAction. */
  recordAutoAction?: (input: Parameters<typeof recordAutoAction>[0]) => void;
  /** Abandon a mission (rollback on card creation failure). Default: setMissionAbandoned. */
  abandonMission?: typeof setMissionAbandoned;
  /** List open escalations for dedup. Default: listOpenEscalations({ project }). */
  listOpenEscalations?: (project: string) => ReturnType<typeof listOpenEscalations>;
  /** Batch size threshold. Default: REPAIR_BATCH_K or REPAIR_FORGE_THRESHOLD env. */
  threshold?: number;
  /** Age trigger in milliseconds. Default: REPAIR_AGE_MS. */
  ageMs?: number;
  /** Injectable clock for deterministic tests. Default: Date.now. */
  now?: number;
}

export interface RepairForgeResult {
  forged: { missionId: string; consumed: string[]; criteriaCount: number; budgetUsd: number } | null;
  reason: 'forged' | 'repair-mission-open' | 'no-batch' | 'forge-rolled-back';
  staleApprovalCards: number;
}

/**
 * One deterministic repair-forge pass. Forges AT MOST ONE repair mission when a batch
 * of bugfix requests clears the selection bar and no repair mission is already open.
 */
export async function runRepairForgePass(
  project: string,
  deps: RepairForgeDeps = {},
): Promise<RepairForgeResult> {
  const listTodosFn = deps.listTodos ?? listTodos;
  const ensureBucketFn = deps.ensureBucket ?? ensureBucket;
  const isBucketItemFn = deps.isBucketItem ?? isBucketItem;
  const listMissionsFn = deps.listMissions ?? ((p: string, allTodos?: Todo[]) => listMissions(p, { allTodos }));
  const forgeFn = deps.forge ?? ((p: string, i: ForgeMissionInput) => forgeMission(p, i));
  const createEscalationFn = deps.createEscalation ?? createEscalation;
  const recordAutoActionFn = deps.recordAutoAction ?? recordAutoAction;
  const abandonMissionFn = deps.abandonMission ?? setMissionAbandoned;
  const listOpenEscalationsFn = deps.listOpenEscalations ?? ((p: string) => listOpenEscalations({ project: p }));
  const threshold = deps.threshold ?? (Number(getConfig('REPAIR_FORGE_THRESHOLD', '') || 0) || REPAIR_BATCH_K);
  const ageMs = deps.ageMs ?? REPAIR_AGE_MS;
  const now = deps.now ?? Date.now();

  // Audit helper: fail-open wrapper for recordAutoActionFn.
  const safeAudit = (input: Parameters<typeof recordAutoAction>[0]): void => {
    try {
      recordAutoActionFn(input);
    } catch (err) {
      // Audit failure is non-fatal; never change the result or throw.
    }
  };

  // One snapshot feeds every read below — the orchestrator tick threads its shared
  // snapshot in (audit 7a); standalone callers fall back to one fresh scan. The
  // tick-todos-snapshot counting test pins that this pass adds ZERO extra scans.
  const allTodos = deps.todosSnapshot ?? listTodosFn(project);

  // STEP 1: CAP FIRST — check for an already-open repair mission (mutation-probe target).
  // If any mission is non-terminal AND auto-forged, refuse.
  const missions = listMissionsFn(project, allTodos);

  // STEP 1.5: Stale-approval backstop — detect and card unapproved missions exceeding
  // the stale threshold. Runs BEFORE the repair-mission-open cap return so a stale
  // unapproved mission still gets its reminder card. Fail-open: a throw here must not
  // change the pass outcome.
  let staleApprovalCards = 0;
  try {
    const staleMissions = missionsAwaitingApprovalPastThreshold(missions, { thresholdMs: REPAIR_APPROVAL_STALE_MS, now });
    const openEscalations = listOpenEscalationsFn(project);

    for (const staleMission of staleMissions) {
      const missionId = staleMission.node.id;
      // Check if an open escalation already names this mission (by conditionKey or todoId)
      const alreadyCarded = openEscalations.some(
        (esc) => esc.conditionKey === `repair-forge:${missionId}` || esc.todoId === missionId,
      );
      if (alreadyCarded) continue;

      // Raise a reminder card for this stale mission
      const awaitingTimeMs = now - (staleMission.mission.awaitingApprovalSince ?? now);
      const awaitingHours = Math.round(awaitingTimeMs / (3600 * 1000));
      try {
        createEscalationFn({
          project,
          session: REPAIR_FORGE_SESSION,
          kind: REPAIR_MISSION_APPROVAL_KIND,
          audience: 'human',
          operatorGated: true,
          todoId: missionId,
          conditionKey: `repair-forge:${missionId}`,
          questionText: `Repair mission awaiting approval for ${awaitingHours}h: ${staleMission.node.title ?? 'Untitled'}.`,
          options: [
            { id: 'approve', label: 'Approve & activate', detail: 'Ratify the mission and drive it.' },
            { id: 'dismiss', label: 'Dismiss', detail: 'Close the mission without acting on it.' },
          ],
        });
        staleApprovalCards++;
      } catch (err) {
        // Card creation failure is non-fatal; log and continue to next mission
      }
    }
  } catch (err) {
    // Stale-approval backstop failure is non-fatal; never change the pass outcome
  }

  const openMission = missions.find(
    (m) => !isMissionTerminal(m.mission) && isAutoForgedRepairMission({ ownerSession: m.ownerSession }),
  );
  if (openMission) {
    safeAudit({
      project,
      action: 'mission-forge',
      outcome: 'capped',
      reason: `repair-mission-open: mission ${openMission.node.id} is still open`,
    });
    return { forged: null, reason: 'repair-mission-open', staleApprovalCards };
  }

  // STEP 2: Resolve the bugfix bucket from the snapshot (ensureBucket does its own
  // full-table scans — only pay them on the miss/creation path, where fresh reads are
  // the point).
  const bucketFromSnapshot = allTodos.find(
    (t) => (t as { isBucket?: boolean | number }).isBucket && t.bucketType === 'bugfix'
      && t.status !== 'done' && t.status !== 'dropped',
  );
  const bucketId = bucketFromSnapshot?.id ?? (await ensureBucketFn(project, 'bugfix'));
  const openBugfixLeaves = allTodos.filter(
    (t) => t.parentId === bucketId && t.status !== 'done' && t.status !== 'dropped' && isBucketItemFn(project, t.id),
  );

  // Convert each to a RepairRequest (id/title/description/bugfixSpec/createdAt).
  const requests: RepairRequest[] = openBugfixLeaves.map((t) => ({
    id: t.id,
    title: t.title ?? null,
    description: t.description ?? null,
    bugfixSpec: t.bugfixSpec ?? null,
    createdAt: new Date(t.createdAt).toISOString(),
  }));

  // STEP 3: Select a batch using deterministic batch selection.
  const batch = selectRepairBatch(requests, { k: threshold, ageMs, now });
  if (!batch) {
    return { forged: null, reason: 'no-batch', staleApprovalCards: 0 };
  }

  // Determine the trigger (size or age) for naming on the card and audit record.
  const trigger = repairBatchTrigger(requests, { k: threshold, ageMs, now }) ?? 'size';

  // Build the trigger suffix for the card text.
  let triggerSuffix = '';
  if (trigger === 'size') {
    triggerSuffix = ` triggered by size (${batch.length} >= k=${threshold})`;
  } else if (trigger === 'age') {
    // batch[0] is the oldest (sorted ascending); compute its age in hours.
    const oldestTime = Date.parse(batch[0].request.createdAt);
    const ageHours = isNaN(oldestTime) ? 0 : Math.round((now - oldestTime) / (3600 * 1000));
    const ageMsHours = Math.round(ageMs / (3600 * 1000));
    triggerSuffix = ` triggered by age (oldest ${ageHours}h > ${ageMsHours}h)`;
  }

  // STEP 4: Build the repair mission spec and forge (with unapproved + inactive).
  const spec = buildRepairMissionSpec(batch);
  const forgeInput: ForgeMissionInput = {
    session: REPAIR_FORGE_SESSION,
    title: spec.title,
    description: spec.description,
    criteria: spec.criteria,
    budgetUsd: spec.budgetUsd,
    approved: false,
    activate: false,
    consumesTodoIds: spec.consumesTodoIds,
  };

  const forgeResult = await forgeFn(project, forgeInput);
  const missionId = forgeResult.missionId;

  // Extract the actual counts from the forge result, with fallbacks to spec.
  // This handles both real forgeMission (which returns full accounting) and test fakes
  // that return only { missionId }.
  const consumed = forgeResult.consumedBucketItems?.consumed ?? spec.consumesTodoIds;
  const criteriaCount = forgeResult.criteria?.length ?? spec.criteria.length;

  // STEP 5: Issue exactly ONE approval card for the whole mission.
  // Wrap in try/catch to rollback the mission if card creation fails.
  try {
    createEscalationFn({
      project,
      session: REPAIR_FORGE_SESSION,
      kind: REPAIR_MISSION_APPROVAL_KIND,
      audience: 'human',
      operatorGated: true,
      todoId: missionId,
      conditionKey: `repair-forge:${missionId}`,
      questionText: `Approve auto-forged repair mission: ${criteriaCount} bugfix${criteriaCount === 1 ? '' : 'es'}, ${spec.budgetUsd} USD budget.${triggerSuffix}`,
      options: [
        { id: 'approve', label: 'Approve & activate', detail: 'Ratify the mission and drive it.' },
        { id: 'dismiss', label: 'Dismiss', detail: 'Close the mission without acting on it.' },
      ],
    });
  } catch (err) {
    // Card creation failed; roll back the mission and return early.
    // Rollback must also be fail-open (a rollback failure cannot mask the original throw).
    try {
      await abandonMissionFn(project, missionId, now);
    } catch (rollbackErr) {
      safeAudit({
        project,
        action: 'mission-forge',
        outcome: 'refused',
        reason: `forge-rolled-back; mission ${missionId}; abandon-failed: ${String(rollbackErr).slice(0, 100)}`,
      });
      return { forged: null, reason: 'forge-rolled-back', staleApprovalCards };
    }

    safeAudit({
      project,
      action: 'mission-forge',
      outcome: 'refused',
      reason: `forge-rolled-back; mission ${missionId}; card-creation-error: ${String(err).slice(0, 100)}`,
    });
    return { forged: null, reason: 'forge-rolled-back', staleApprovalCards };
  }

  // Emit performed audit row with trigger, batch size, and budget details.
  safeAudit({
    project,
    action: 'mission-forge',
    outcome: 'performed',
    reason: `trigger=${trigger}; batch=${batch.length}; budget=${spec.budgetUsd}`,
    detail: {
      missionId,
      consumed,
      criteriaCount,
    },
  });

  return {
    forged: {
      missionId,
      consumed,
      criteriaCount,
      budgetUsd: spec.budgetUsd,
    },
    reason: 'forged',
    staleApprovalCards,
  };
}

export type RepairApprovalOutcome =
  | { applied: 'approved'; missionId: string; approvedConstraints: number }
  | { applied: 'dismissed'; missionId: string; reopened: string[] }
  | { applied: 'noop'; reason: string };

export interface RepairApprovalDeps {
  getMission?: typeof getMission;
  approveMission?: (project: string, missionId: string, approvedBy: string) => Promise<{ approvedConstraints: Array<{ id: string }> }>;
  setMissionAbandoned?: typeof setMissionAbandoned;
  reopenConsumedFor?: (project: string, consumerId: string) => string[];
  consumerDelivered?: (project: string, consumerId: string) => boolean;
  now?: number;
  actor?: string;
}

export async function applyRepairApprovalDecision(
  project: string,
  missionId: string,
  optionId: string | null,
  deps: RepairApprovalDeps = {},
): Promise<RepairApprovalOutcome> {
  const getMissionFn = deps.getMission ?? getMission;
  const now = deps.now ?? Date.now();
  const actor = deps.actor ?? 'human:repair-approval-card';

  // Unknown/absent optionId → noop
  if (!optionId) {
    return { applied: 'noop', reason: `no option selected for mission ${missionId}` };
  }

  // Check mission exists
  const mission = getMissionFn(project, missionId);
  if (!mission) {
    return { applied: 'noop', reason: `mission not found: ${missionId}` };
  }

  // Approve branch
  if (optionId === 'approve') {
    const approveFn = deps.approveMission ?? approveMissionAndConstitution;
    const result = await approveFn(project, missionId, actor);
    return {
      applied: 'approved',
      missionId,
      approvedConstraints: result.approvedConstraints.length,
    };
  }

  // Dismiss branch
  if (optionId === 'dismiss') {
    const reopenFn = deps.reopenConsumedFor ?? reopenConsumedFor;
    const deliveredFn = deps.consumerDelivered ?? consumerDelivered;
    const abandonFn = deps.setMissionAbandoned ?? setMissionAbandoned;

    let reopened: string[] = [];
    if (!deliveredFn(project, missionId)) {
      reopened = reopenFn(project, missionId);
    }

    await abandonFn(project, missionId, now);

    return {
      applied: 'dismissed',
      missionId,
      reopened,
    };
  }

  return { applied: 'noop', reason: `unknown option: ${optionId}` };
}
