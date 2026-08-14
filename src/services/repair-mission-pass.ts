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

import { REPAIR_FORGE_SESSION, isAutoForgedRepairMission, REPAIR_BATCH_K, REPAIR_AGE_MS, REPAIR_BUDGET_USD, selectRepairBatch, buildRepairMissionSpec, type RepairRequest, type RepairBatchItem } from './repair-mission-forge.js';
import { ensureBucket } from './bucket-registry.js';
import { isBucketItem } from './bucket-consumption.js';
import { listTodos, getTodo, type Todo } from './todo-store.js';
import { listMissions, listCriteria, isMissionTerminal, type MissionSummary } from './mission-store.js';
import { forgeMission, type ForgeMissionInput } from '../mcp/tools/mission-forge.js';
import { createEscalation, type EscalationOption } from './supervisor-store.js';
import { getConfig } from './config-service.js';

export const REPAIR_MISSION_APPROVAL_KIND = 'repair-mission-approval';

/** Minimum spacing between repair-forge passes for a single project. */
export const REPAIR_FORGE_INTERVAL_MS = 300_000; // 5 min

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
  listMissions?: (project: string) => MissionSummary[];
  /** Forge a mission from input spec. Default: forgeMission. */
  forge?: (project: string, input: ForgeMissionInput) => Promise<{ missionId: string }>;
  /** Create an escalation card. Default: createEscalation. Must be injectable for tests (throws on tmp paths). */
  createEscalation?: (input: Parameters<typeof createEscalation>[0]) => ReturnType<typeof createEscalation>;
  /** Batch size threshold. Default: REPAIR_BATCH_K or REPAIR_FORGE_THRESHOLD env. */
  threshold?: number;
  /** Age trigger in milliseconds. Default: REPAIR_AGE_MS. */
  ageMs?: number;
  /** Injectable clock for deterministic tests. Default: Date.now. */
  now?: number;
}

export interface RepairForgeResult {
  forged: { missionId: string; consumed: string[]; criteriaCount: number; budgetUsd: number } | null;
  reason: 'forged' | 'repair-mission-open' | 'no-batch';
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
  const listMissionsFn = deps.listMissions ?? ((p: string) => listMissions(p));
  const forgeFn = deps.forge ?? ((p: string, i: ForgeMissionInput) => forgeMission(p, i));
  const createEscalationFn = deps.createEscalation ?? createEscalation;
  const threshold = deps.threshold ?? (Number(getConfig('REPAIR_FORGE_THRESHOLD', '') || 0) || REPAIR_BATCH_K);
  const ageMs = deps.ageMs ?? REPAIR_AGE_MS;
  const now = deps.now ?? Date.now();

  // STEP 1: CAP FIRST — check for an already-open repair mission (mutation-probe target).
  // If any mission is non-terminal AND auto-forged, refuse.
  const missions = listMissionsFn(project);
  const hasOpenRepairMission = missions.some(
    (m) => !isMissionTerminal(m.mission) && isAutoForgedRepairMission({ ownerSession: m.ownerSession }),
  );
  if (hasOpenRepairMission) {
    return { forged: null, reason: 'repair-mission-open' };
  }

  // STEP 2: Resolve the bugfix bucket and collect open bucket items.
  const bucketId = await ensureBucketFn(project, 'bugfix');
  const allTodos = deps.todosSnapshot ?? listTodosFn(project);
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
    return { forged: null, reason: 'no-batch' };
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

  // STEP 5: Issue exactly ONE approval card for the whole mission.
  createEscalationFn({
    project,
    session: REPAIR_FORGE_SESSION,
    kind: REPAIR_MISSION_APPROVAL_KIND,
    audience: 'human',
    operatorGated: true,
    todoId: missionId,
    conditionKey: `repair-forge:${missionId}`,
    questionText: `Approve auto-forged repair mission: ${batch.length} bugfix${batch.length === 1 ? '' : 'es'}, ${spec.budgetUsd} USD budget.`,
    options: [
      { id: 'approve', label: 'Approve & activate', detail: 'Ratify the mission and drive it.' },
      { id: 'dismiss', label: 'Dismiss', detail: 'Close the mission without acting on it.' },
    ],
  });

  return {
    forged: {
      missionId,
      consumed: spec.consumesTodoIds,
      criteriaCount: spec.criteria.length,
      budgetUsd: spec.budgetUsd,
    },
    reason: 'forged',
  };
}
