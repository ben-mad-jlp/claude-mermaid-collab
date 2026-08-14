/**
 * repair-verify-filer.ts — Auto-file one deduped verify explore per live-verifiable criterion
 * of a converged repair mission.
 *
 * Runs on a throttled interval per project. Reads converged auto-forged repair missions,
 * selects their MET criteria with named anchors, and files one explore leaf per criterion
 * to VERIFY the fix actually works. Deduped: a criterion whose tag already appears in an
 * existing explore leaf (including completed leaves) is skipped forever.
 *
 * No LLM; purely deterministic. Read-only w.r.t. missions/criteria (the only write is the
 * explore leaf created by fileExploreRequest). Reuses the existing explore-run epic path.
 */

import { REPAIR_FORGE_SESSION, isAutoForgedRepairMission } from './repair-mission-forge.js';
import { listMissions, listCriteria, type MissionSummary } from './mission-store.js';
import { listTodos, type Todo } from './todo-store.js';
import { fileExploreRequest, ExploreOracleRefusedError } from '../mcp/workgraph-tools.js';
import { hasNamedAnchor } from './explore-request.js';
import { getConfig } from './config-service.js';
import { recordAutoAction, MAX_VERIFY_EXPLORES_PER_PASS } from './auto-action-audit.js';

export { MAX_VERIFY_EXPLORES_PER_PASS };

export const REPAIR_VERIFY_FILER_INTERVAL_MS = 300_000; // 5 min

const lastRepairVerifyFilerMs = new Map<string, number>();

/**
 * Throttle gate for runRepairVerifyFilerPass. Returns true (and records `now` as the last
 * run) when the pass is due for `project`; false while a previous run is within
 * REPAIR_VERIFY_FILER_INTERVAL_MS. First call for a project always runs. `now` is injectable
 * for deterministic tests.
 */
export function shouldRunRepairVerifyFilerPass(project: string, now: number = Date.now()): boolean {
  const last = lastRepairVerifyFilerMs.get(project);
  if (last !== undefined && now - last < REPAIR_VERIFY_FILER_INTERVAL_MS) return false;
  lastRepairVerifyFilerMs.set(project, now);
  return true;
}

/** Test seam: clear the per-project throttle clock (all projects, or one). */
export function _resetRepairVerifyFilerThrottle(project?: string): void {
  if (project === undefined) lastRepairVerifyFilerMs.clear();
  else lastRepairVerifyFilerMs.delete(project);
}

/**
 * Extract the first named anchor from text using the same patterns as hasNamedAnchor.
 * Returns null if no anchor is found. This is the inverse of hasNamedAnchor: when
 * hasNamedAnchor is false, this always returns null.
 *
 * Order matters: check path:line BEFORE dotted notation (to avoid matching "foo.ts"
 * in "src/services/foo.ts:42"); check hash before golden (to prefer the more specific).
 */
export function extractNamedAnchor(text: string): string | null {
  if (!text) return null;

  // Check for path:line format FIRST (before dotted notation which could match the filename).
  const pathMatch = /\S+[\\/\.]\S*:\d+/.exec(text);
  if (pathMatch) return pathMatch[0];

  // Check for dotted notation: word.word or word.word.word, etc.
  const dottedMatch = /[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+/i.exec(text);
  if (dottedMatch) return dottedMatch[0];

  // Check for camelCase: lowercase followed by uppercase letter.
  const camelMatch = /[a-z]+[A-Z][a-zA-Z0-9]*/.exec(text);
  if (camelMatch) return camelMatch[0];

  // Check for snake_case: lowercase/digit, underscore, lowercase/digit.
  const snakeMatch = /[a-z0-9]+_[a-z0-9_]+/i.exec(text);
  if (snakeMatch) return snakeMatch[0];

  // Check for hash/golden references (hash before golden to prefer the more specific).
  const hashMatch = /\b[0-9a-f]{7,}\b/i.exec(text);
  if (hashMatch) return hashMatch[0];

  const goldenMatch = /\bgolden\b/i.exec(text);
  if (goldenMatch) return goldenMatch[0];

  return null;
}

/**
 * Pure half: derive a verify explore specification from a criterion.
 * Returns {scope, target, oracle} or null if the criterion has no named anchor.
 *
 * - oracle = criterion.text VERBATIM (the fixed-means clause)
 * - target = the first named anchor the criterion text contains
 * - scope = missionTitle
 * - Returns null when hasNamedAnchor(criterion.text) is false
 */
export function deriveVerifyExplore(
  criterion: { id: string; text: string },
  missionTitle: string,
): { scope: string; target: string; oracle: string } | null {
  if (!hasNamedAnchor(criterion.text)) {
    return null;
  }

  const target = extractNamedAnchor(criterion.text);
  if (!target) {
    // Fail closed: if hasNamedAnchor said true but extractNamedAnchor returns null,
    // this is a consistency violation — treat it as untargetable.
    return null;
  }

  return {
    scope: missionTitle,
    target,
    oracle: criterion.text,
  };
}

export interface RepairVerifyFilerDeps {
  /** Read todos for a project. Default: listTodos. */
  listTodos?: (project: string) => Todo[];
  /** Optional todos snapshot (audit item 7a). Passed by the orchestrator tick. */
  todosSnapshot?: Todo[];
  /** List missions in a project. Default: listMissions. */
  listMissions?: (project: string, allTodos?: Todo[]) => MissionSummary[];
  /** List criteria for a mission. Default: listCriteria. */
  listCriteria?: (project: string, missionId: string) => Array<{ id: string; text: string; met: boolean; status: string }>;
  /** File an explore request. Default: fileExploreRequest. */
  fileExplore?: (project: string, session: string, opts: { scope: string; target: string; oracle: string; description: string }) => Promise<{ leaf: Todo }>;
  /** Injectable clock for deterministic tests. Default: Date.now. */
  now?: number;
  /** Record auto-action audit events. Default: recordAutoAction. */
  recordAutoAction?: (input: Parameters<typeof recordAutoAction>[0]) => void;
}

export interface RepairVerifyFilerResult {
  filed: string[];
  skipped: number;
  missionsScanned: number;
  cappedAt?: number;
}

/**
 * One deterministic repair-verify-filer pass. Scans converged auto-forged repair missions,
 * files one explore per MET criterion with a named anchor, and dedupes by criterion tag.
 */
export async function runRepairVerifyFilerPass(
  project: string,
  deps: RepairVerifyFilerDeps = {},
): Promise<RepairVerifyFilerResult> {
  const listTodosFn = deps.listTodos ?? listTodos;
  const listMissionsFn = deps.listMissions ?? ((p: string, allTodos?: Todo[]) => listMissions(p, { allTodos }));
  const listCriteriaFn = deps.listCriteria ?? ((p: string, missionId: string) => {
    return listCriteria(p, missionId).map((c) => ({
      id: c.id,
      text: c.text,
      met: c.met,
      status: c.status,
    }));
  });
  const fileExploreFn = deps.fileExplore ?? fileExploreRequest;
  const recordAutoActionFn = deps.recordAutoAction ?? recordAutoAction;

  const allTodos = deps.todosSnapshot ?? listTodosFn(project);

  const filed: string[] = [];
  let skipped = 0;
  let missionsScanned = 0;
  let cappedAt: number | undefined;

  // Fail-open helper: wrap audit writes so an audit failure cannot sink the pass.
  const safeAudit = (input: Parameters<typeof recordAutoAction>[0]): void => {
    try {
      recordAutoActionFn(input);
    } catch {
      // Audit is fail-open; ignore any error.
    }
  };

  // Read all missions and filter for converged auto-forged repair missions.
  const missions = listMissionsFn(project, allTodos);
  const convergedRepairMissions = missions.filter(
    (m) =>
      m.mission.status === 'converged' &&
      isAutoForgedRepairMission({ ownerSession: m.ownerSession }),
  );

  missions: for (const mission of convergedRepairMissions) {
    missionsScanned++;
    const missionTitle = mission.node.title ?? `Repair mission ${mission.node.id.slice(0, 8)}`;

    // Read criteria for this mission.
    const criteria = listCriteriaFn(project, mission.node.id);

    // Filter for MET criteria that are not dropped.
    const metCriteria = criteria.filter(
      (c) => c.met === true && c.status !== 'dropped',
    );

    for (let i = 0; i < metCriteria.length; i++) {
      const criterion = metCriteria[i]!;

      // Check pass-wide cap: if we've already filed at MAX_VERIFY_EXPLORES_PER_PASS,
      // count remaining criteria as skipped and break.
      if (filed.length >= MAX_VERIFY_EXPLORES_PER_PASS) {
        const remaining = metCriteria.length - i;
        skipped += remaining;
        cappedAt = filed.length;
        safeAudit({
          project,
          action: 'verify-explore',
          outcome: 'capped',
          reason: `per-pass-cap: reached MAX_VERIFY_EXPLORES_PER_PASS ${MAX_VERIFY_EXPLORES_PER_PASS}, ${remaining} criteria left unfiled`,
        });
        break missions;
      }

      // Skip if there's already an explore with this criterion's tag.
      const tag = `criterion:${criterion.id}`;
      const existingExplore = allTodos.find(
        (t) =>
          t.exploreSpec &&
          t.description &&
          t.description.includes(tag)
      );

      if (existingExplore) {
        skipped++;
        continue;
      }

      // Derive the explore spec.
      const spec = deriveVerifyExplore(criterion, missionTitle);
      if (!spec) {
        // No named anchor — skip this criterion.
        skipped++;
        continue;
      }

      // File the explore.
      try {
        const result = await fileExploreFn(project, REPAIR_FORGE_SESSION, {
          scope: spec.scope,
          target: spec.target,
          oracle: spec.oracle,
          description: `${tag} — ${criterion.text}`,
        });
        filed.push(result.leaf.id);
        safeAudit({
          project,
          action: 'verify-explore',
          outcome: 'performed',
          reason: `verify MET criterion ${criterion.id} of converged repair mission ${mission.node.id}`,
          detail: {
            leafId: result.leaf.id,
            criterionId: criterion.id,
            missionId: mission.node.id,
          },
        });
      } catch (err) {
        // Catch and count all filing errors — never sink the pass.
        const message = err instanceof Error ? err.message : String(err);
        const reason = err instanceof ExploreOracleRefusedError
          ? `oracle-refused: ${err.message}`
          : `filing-failed: ${message}`;
        safeAudit({
          project,
          action: 'verify-explore',
          outcome: 'refused',
          reason,
          detail: { criterionId: criterion.id },
        });
        skipped++;
      }
    }
  }

  return { filed, skipped, missionsScanned, cappedAt };
}

// Re-export listCriteria for convenience
export { listCriteria } from './mission-store.js';
