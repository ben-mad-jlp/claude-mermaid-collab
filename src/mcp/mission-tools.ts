// Mission MCP tool surface — extracted verbatim from setup.ts.
//
// This module owns the cohesive MISSION tool group: the ListTools declarations
// (MISSION_TOOL_DEFS) and the CallTool handlers (handleMissionTool). Behavior is
// identical to the original inline setup.ts implementation — this is a pure move.
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import {
  getTodo, deriveTodoViews, reassignOwnerSession, updateTodo as updateTodoStore,
} from '../services/todo-store.js';
import {
  upsertMission, getMission,
  addCriterion, setCriterionMet, setCriterionVerdict, updateCriterionText, removeCriterion, listCriteria, listCriteriaWithActions, getMissionRollup,
  activateMission, sessionHasActiveMission, setMissionActive, deleteMission, setMissionAbandoned,
} from '../services/mission-store.js';
import { isMission, stripLabel } from '../services/todo-kind.js';
import { getMissionCost } from '../services/mission-cost.js';
import { addSessionTodo } from './tools/session-todos.js';

/**
 * ListTools declarations for the mission tool group. Spread into the ListTools
 * array in setup.ts via `...MISSION_TOOL_DEFS`.
 */
export const MISSION_TOOL_DEFS = [
      { name: 'create_mission', description: "Create a durable MISSION — a convergence goal toward which the work-graph evolves. It is a top-level MISSION work-graph node (kind='mission', non-closing root) plus acceptance criteria (the VERIFY gate — the true 'done' signal). Mission status is derived from the work-graph (epic children, leaf runs), acceptance criteria (met/unverified), and human abandonment. Set `criteria` (what must be true for the mission to converge). Returns node + control state + rollup.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, title: { type: 'string', description: 'Mission goal, stated bare — do not prefix it. The role lives in the `kind` column and is rendered by the UI.' }, description: { type: 'string' }, criteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria = the VERIFY gate; convergence = all met.' }, budgetUsd: { type: 'number', description: 'Optional per-mission USD budget ceiling (null = project default).' } }, required: ['project', 'session', 'title'] } },
      { name: 'set_active_mission', description: "Make ONE mission the ACTIVE mission for its owning session and deactivate every OTHER mission owned by that session — a steward drives one mission at a time, and the mission-loop pass only drives the active one. Missions of other sessions are untouched. Returns the deactivated ids.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' } }, required: ['project', 'todoId'] } },
      { name: 'update_mission', description: "Edit a mission's node — its title (goal) and/or description. The role is carried by `kind` and is never written into the title. Loop state (phase/iteration/criteria/verdicts) is untouched.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, title: { type: 'string', description: 'New goal text, bare — no role prefix.' }, description: { type: 'string' }, abandonedAt: { type: ['number', 'null'], description: 'Human-set abandonment stamp (ms epoch); null clears it. Set to mark the mission "done with it".' } }, required: ['project', 'todoId'] } },
      { name: 'delete_mission', description: "Permanently delete a mission — drops the mission work-graph node AND its loop-control state + criteria. Irreversible. Use to remove a mis-created or abandoned mission (vs converge/stop which keep it as a completed record).", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' } }, required: ['project', 'todoId'] } },
      { name: 'update_mission_criterion', description: "Edit an acceptance criterion's TEXT (the assertion). Does not change its met/verdict — use set_mission_criterion for that.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, criterionId: { type: 'string' }, text: { type: 'string' } }, required: ['project', 'criterionId', 'text'] } },
      { name: 'set_mission_owner', description: "Re-home a MISSION to a different session — reassign its ownerSession (and assigneeSession) so its card AND the mission-loop nudge target the right (live) session. Use when a mission was created under the wrong session name; preserves all mission state (criteria, verdicts). todoId must be a mission node (kind='mission').", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string', description: 'The mission node id.' }, session: { type: 'string', description: 'The session to own/drive the mission (e.g. the live board session).' } }, required: ['project', 'todoId', 'session'] } },
      { name: 'get_mission', description: 'Read a mission\'s full state: control state, acceptance criteria (each with a DERIVED per-criterion `action`: met|building|verify|discover — serve EVERY discover gap in one pass, one epic per criterion), and the convergence rollup — mechanical (direct [EPIC] children done/total) + capability (criteria met/total) + gaps/awaitingVerify + converged flag.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string', description: 'The mission node id.' } }, required: ['project', 'todoId'] } },
      { name: 'add_mission_criterion', description: 'Add an acceptance criterion (a capability assertion) to a mission. Convergence is reached when every criterion is met (see set_mission_criterion). Returns the created criterion.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, text: { type: 'string' } }, required: ['project', 'todoId', 'text'] } },
      { name: 'set_mission_criterion', description: "Record a VERIFY-gate verdict on a mission acceptance criterion: met/unmet PLUS the `evidence` the judge cited and `verifiedBy` (who judged). This should be filled by an INDEPENDENT check (maker≠checker) that fails CLOSED — do not self-grade the work you did. Pass remove=true to delete the criterion instead. Convergence = all criteria met.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, criterionId: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string', description: 'Why the judge ruled this met/unmet (the ground-truth citation).' }, verifiedBy: { type: 'string', description: 'Handle of the independent judge (e.g. the reviewer agent id / role).' }, verifiedAtSha: { type: 'string', description: 'Git sha the verdict was checked against (staleness pin).' }, evidencePaths: { type: 'array', items: { type: 'string' }, description: 'File paths the verdict cited (a later land-diff touching one re-opens this criterion).' }, remove: { type: 'boolean', description: 'If true, delete the criterion (ignores met).' } }, required: ['project', 'criterionId'] } },
];

/**
 * Handle a mission-group CallTool invocation. Returns the JSON string result
 * (identical to the original inline setup.ts handler), or `null` if `name` is
 * not a mission tool — in which case the caller falls through to its own switch.
 */
export async function handleMissionTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'create_mission': {
      const { project, session, title, description, criteria, budgetUsd } = args as {
        project: string; session: string; title: string; description?: string; criteria?: string[];
        budgetUsd?: number | null;
      };
      if (!project || !session || !title) throw new Error('Missing required: project, session, title');
      // Store the BARE goal. `kind` is the only role signal (stage C, decision e852fb0c);
      // stripLabel drops a role bracket an operator may have typed, never a topic tag.
      const missionTitle = stripLabel(title);
      if (!missionTitle) throw new Error('title must be non-empty after stripping the role prefix');
      // A mission node is a legitimate top-level root (resolveTodoParent exempts it by
      // `kind`, not by title), so allowOrphan isn't needed — addSessionTodo creates it
      // parentless.
      const node = await addSessionTodo(project, session, missionTitle, undefined, {
        kind: 'mission',
        assigneeSession: session, description,
      });
      upsertMission(project, node.id, { budgetUsd: budgetUsd ?? null });
      // One-active-per-session: if this session is already driving an active mission,
      // create the new one INACTIVE (don't steal focus). Otherwise it stays active.
      if (sessionHasActiveMission(project, session, node.id)) setMissionActive(project, node.id, false);
      for (const c of criteria ?? []) { if (c.trim()) addCriterion(project, node.id, c); }
      getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session, ownerSession: node.ownerSession, assigneeSession: node.assigneeSession ?? undefined });
      return JSON.stringify({
        node: deriveTodoViews(project, [node])[0],
        mission: getMission(project, node.id),
        criteria: listCriteria(project, node.id),
        rollup: getMissionRollup(project, node.id),
      }, null, 2);
    }
    case 'get_mission': {
      const { project, todoId } = args as { project: string; todoId: string };
      if (!project || !todoId) throw new Error('Missing required: project, todoId');
      const mission = getMission(project, todoId);
      if (!mission) throw new Error(`mission not found: ${todoId}`);
      return JSON.stringify({
        // Criteria carry the DERIVED per-criterion `action` ('met'|'building'|'verify'|'discover')
        // + servingEpicState — the conductor serves EVERY 'discover' gap in one pass; the scalar
        // mission.status is only the headline.
        mission, criteria: listCriteriaWithActions(project, todoId), rollup: getMissionRollup(project, todoId),
        cost: getMissionCost(project, todoId),
      }, null, 2);
    }
    case 'set_mission_owner': {
      const { project, todoId, session } = args as { project: string; todoId: string; session: string };
      if (!project || !todoId || !session) throw new Error('Missing required: project, todoId, session');
      const node = getTodo(project, todoId);
      if (!node) throw new Error(`todo not found: ${todoId}`);
      if (!isMission(node)) throw new Error(`not a mission node (kind='mission'): ${todoId}`);
      const updated = await reassignOwnerSession(project, todoId, session);
      return JSON.stringify({ todoId, ownerSession: updated.ownerSession, assigneeSession: updated.assigneeSession }, null, 2);
    }
    case 'set_active_mission': {
      const { project, todoId } = args as { project: string; todoId: string };
      if (!project || !todoId) throw new Error('Missing required: project, todoId');
      if (!getMission(project, todoId)) throw new Error(`mission not found: ${todoId}`);
      const deactivated = activateMission(project, todoId);
      // Sync subscriptions: subscribe the activated mission and unsubscribe deactivated ones.
      try {
        const { syncMissionSubscription } = await import('../services/mission-subscription.js');
        syncMissionSubscription(project, todoId);
        for (const id of deactivated) {
          syncMissionSubscription(project, id);
        }
      } catch (e) {
        // Subscription failure must never fail the mission tool.
        console.warn('mission subscription sync failed (non-fatal):', (e as Error).message);
      }
      return JSON.stringify({ active: todoId, deactivated }, null, 2);
    }
    case 'update_mission': {
      const { project, todoId, title, description, abandonedAt } = args as { project: string; todoId: string; title?: string; description?: string; abandonedAt?: number | null };
      if (!project || !todoId) throw new Error('Missing required: project, todoId');
      const node = getTodo(project, todoId);
      if (!node) throw new Error(`todo not found: ${todoId}`);
      if (!isMission(node)) throw new Error(`not a mission node (kind='mission'): ${todoId}`);
      const patch: { title?: string; description?: string } = {};
      if (title !== undefined) {
        const next = stripLabel(title);
        if (!next) throw new Error('title must be non-empty after stripping the role prefix');
        patch.title = next;
      }
      if (description !== undefined) patch.description = description;
      const updated = await updateTodoStore(project, todoId, patch);
      let abandoned = node && isMission(node) ? getMission(project, todoId)?.abandonedAt ?? null : null;
      if (abandonedAt !== undefined) {
        abandoned = setMissionAbandoned(project, todoId, abandonedAt).abandonedAt;
      }
      return JSON.stringify({ todoId, title: updated.title, description: updated.description, abandonedAt: abandoned }, null, 2);
    }
    case 'delete_mission': {
      const { project, todoId } = args as { project: string; todoId: string };
      if (!project || !todoId) throw new Error('Missing required: project, todoId');
      const node = getTodo(project, todoId);
      if (!node) throw new Error(`todo not found: ${todoId}`);
      if (!isMission(node)) throw new Error(`not a mission node (kind='mission'): ${todoId}`);
      const ownerSession = node.ownerSession ?? node.assigneeSession ?? null;
      deleteMission(project, todoId);            // control state + criteria
      // Remove subscription before dropping the node (owner needed for unsubscribe).
      if (ownerSession) {
        try {
          const { unsubscribeMission } = await import('../services/mission-subscription.js');
          unsubscribeMission(project, todoId, ownerSession);
        } catch (e) {
          console.warn('mission subscription cleanup failed (non-fatal):', (e as Error).message);
        }
      }
      await updateTodoStore(project, todoId, { status: 'dropped' }); // drop the graph node
      return JSON.stringify({ deleted: todoId }, null, 2);
    }
    case 'update_mission_criterion': {
      const { project, criterionId, text } = args as { project: string; criterionId: string; text: string };
      if (!project || !criterionId || !text) throw new Error('Missing required: project, criterionId, text');
      updateCriterionText(project, criterionId, text);
      return JSON.stringify({ criterionId, text }, null, 2);
    }
    case 'add_mission_criterion': {
      const { project, todoId, text } = args as { project: string; todoId: string; text: string };
      if (!project || !todoId || !text) throw new Error('Missing required: project, todoId, text');
      if (!getMission(project, todoId)) throw new Error(`mission not found: ${todoId}`);
      const criterion = addCriterion(project, todoId, text);
      return JSON.stringify({ criterion, rollup: getMissionRollup(project, todoId) }, null, 2);
    }
    case 'set_mission_criterion': {
      const { project, criterionId, met, evidence, verifiedBy, verifiedAtSha, evidencePaths, remove } = args as {
        project: string; criterionId: string; met?: boolean; evidence?: string; verifiedBy?: string; verifiedAtSha?: string; evidencePaths?: string[]; remove?: boolean;
      };
      if (!project || !criterionId) throw new Error('Missing required: project, criterionId');
      if (remove) { removeCriterion(project, criterionId); return JSON.stringify({ removed: criterionId }, null, 2); }
      if (typeof met !== 'boolean') throw new Error('met (boolean) is required unless remove=true');
      if (evidence !== undefined || verifiedBy !== undefined || verifiedAtSha !== undefined || evidencePaths !== undefined) {
        setCriterionVerdict(project, criterionId, { met, evidence, verifiedBy, verifiedAtSha, evidencePaths });
      } else {
        setCriterionMet(project, criterionId, met);
      }
      return JSON.stringify({ criterionId, met, evidence: evidence ?? null, verifiedBy: verifiedBy ?? null, verifiedAtSha: verifiedAtSha ?? null, evidencePaths: evidencePaths ?? [] }, null, 2);
    }
    default:
      return null;
  }
}
