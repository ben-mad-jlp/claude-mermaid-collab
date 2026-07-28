// Mission MCP tool surface — extracted verbatim from setup.ts.
//
// This module owns the cohesive MISSION tool group: the ListTools declarations
// (MISSION_TOOL_DEFS) and the CallTool handlers (handleMissionTool). Behavior is
// identical to the original inline setup.ts implementation — this is a pure move.
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import {
  getTodo, deriveTodoViews, updateTodo as updateTodoStore,
} from '../services/todo-store.js';
import {
  upsertMission, getMission,
  addCriterion, setCriterionMet, setCriterionVerdict, updateCriterionText, removeCriterion, listCriteria, listCriteriaWithActions, getMissionRollup,
  activateMission, projectHasActiveMission, enqueueMission, deleteMission, setMissionAbandoned,
  assertMissionCreationAllowed, listMissions, isMissionTerminal, setMissionBudget,
} from '../services/mission-store.js';
import { isMission, stripLabel } from '../services/todo-kind.js';
import { getMissionCost } from '../services/mission-cost.js';
import { addSessionTodo } from './tools/session-todos.js';
import { forgeMission, missionConstitutionHealth, forgeMissionFromDoc, approveMissionAndConstitution } from './tools/mission-forge.js';
import { planMissionCriterion } from './tools/mission-planner.js';
import { collectVerifyStakesInput } from '../services/criterion-verify-facts.js';
import { classifyVerifyStakes } from '../services/criterion-verify-stakes.js';
import { joinPanelVerdicts, normalizePanelVerdicts, VERIFY_LENSES, type PanelVerdict } from '../services/criterion-verify-panel.js';
import { coerceArrayArg } from './arg-coercion.js';

/**
 * ListTools declarations for the mission tool group. Spread into the ListTools
 * array in setup.ts via `...MISSION_TOOL_DEFS`.
 */
export const MISSION_TOOL_DEFS = [
      { name: 'create_mission', description: "Create a durable MISSION — a convergence goal toward which the work-graph evolves. It is a top-level MISSION work-graph node (kind='mission', non-closing root) plus acceptance criteria (the VERIFY gate — the true 'done' signal). Mission status is derived from the work-graph (epic children, leaf runs), acceptance criteria (met/unverified), and human abandonment. Set `criteria` (what must be true for the mission to converge). Returns node + control state + rollup.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, title: { type: 'string', description: 'Mission goal, stated bare — do not prefix it. The role lives in the `kind` column and is rendered by the UI.' }, description: { type: 'string' }, criteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria = the VERIFY gate; convergence = all met.' }, budgetUsd: { type: 'number', description: 'Optional per-mission USD budget ceiling (null = project default).' }, handoffDocId: { type: 'string', description: "Optional handoff/brief DOCUMENT id (session doc) — the mission's constitution: locked constraints, sequencing rationale, out-of-scope list. Stored on the mission row so the conductor resolves it durably instead of by description-text convention." } }, required: ['project', 'session', 'title'] } },
      { name: 'forge_mission', description: "FORGE a mission AND its full constitution in ONE atomic, validated operation — the machinery half of /mission-forge. Beyond create_mission (node + criteria) it instantiates the constitution so it actually REACHES the builders: each `constraints[]` rule becomes an ACTIVE constraint decision-record linked to the mission (injected into every blueprint/implement/review node via payload C, and cross-checked by the review cite-gate); each `rejectedAlternatives[]` becomes a decision record whose alternatives are surfaced to blueprint nodes as 'do not re-propose' (payload D); `digest` is written to .collab/mission-digests/<missionId>.md (payload A); payload A is resolved for the ACTIVE mission's digest at builder-spawn time, so forging with `activate:false` STORES a digest without changing what currently-spawning builders receive. A constitution rule left only in handoff prose is decoration the builder never sees — this makes instantiation mechanical, not a step you can forget. Validates criteria up front (≥1 required) so no half-forged mission. Returns node + criteria + created constraint/decision records + rollup.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, title: { type: 'string', description: 'Mission goal, stated bare — no role prefix.' }, description: { type: 'string' }, criteria: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria = the VERIFY gate. At least one non-empty criterion is REQUIRED.' }, constraints: { type: 'array', description: 'Locked invariants → active constraint records (payload C). Each is a hard rule the builders must respect.', items: { type: 'object', properties: { rule: { type: 'string', description: 'The locked rule, one line (becomes the constraint that injects).' }, rationale: { type: 'string', description: 'Why it is locked.' } }, required: ['rule'] } }, rejectedAlternatives: { type: 'array', description: 'Design decisions whose rejected options a skeptical consult killed → decision records (payload D: "do not re-propose").', items: { type: 'object', properties: { title: { type: 'string' }, rationale: { type: 'string' }, alternatives: { type: 'array', items: { type: 'string' } } }, required: ['title', 'alternatives'] } }, digest: { type: 'string', description: 'Curated orientation facts (≤ ~2k tokens) → .collab/mission-digests/<missionId>.md, resolved for the ACTIVE mission at spawn time. Headline facts only — every byte is a per-leaf tax.' }, handoffDocId: { type: 'string', description: "The handoff/constitution DOCUMENT id, stored on the mission row." }, budgetUsd: { type: 'number', description: 'Optional per-mission USD budget ceiling.' }, activate: { type: 'boolean', description: 'Activate for the conductor session (default true); respects one-active-per-session.' } }, required: ['project', 'session', 'title', 'criteria'] } },
      { name: 'forge_mission_from_doc', description: "FORGE a mission FROM a collab document via a server-side `forge` NODE. The node (model/effort configurable per-project via node_profile_override for kind 'forge' — like blueprint/implement/review — and overridable per call) reads the doc, surveys the repo, and emits a structured mission spec (criteria, constraints, rejected alternatives, digest); forge_mission then instantiates it as an UNAPPROVED mission (status 'unapproved', inactive, constraints left PROPOSED) that sits in the list until a human runs approve_mission. Judgment is the node's; instantiation is machinery. The source doc becomes the mission's handoff/constitution. Returns the forged mission + the parsed spec + the model/effort used.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string', description: 'The session that owns the source document (its documents dir is read).' }, docId: { type: 'string', description: 'The collab document id (a problem/design writeup) to forge from.' }, model: { type: 'string', description: 'Per-call model override (else node_profile_override[forge] → opus).' }, effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'], description: 'Per-call effort override (else node_profile_override[forge] → high).' } }, required: ['project', 'session', 'docId'] } },
      { name: 'approve_mission', description: "APPROVE a forged (unapproved) mission: clears its 'unapproved' status so it becomes active/driveable, AND ratifies its constitution by flipping its PROPOSED linked constraint records to active (so payload C injects them into every builder). Use after reviewing a mission produced by forge_mission_from_doc. Returns the updated mission + the constraints activated.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string', description: 'The mission node id.' }, approvedBy: { type: 'string', description: 'Who approved (handle recorded on the constraint records).' } }, required: ['project', 'todoId'] } },
      { name: 'plan_mission_criterion', description: "DELEGATE planning to a specialist PLANNER node: decompose one-or-more acceptance criteria into ONE right-sized epic + its leaves (with deps), grounded against the real code, and instantiate it PROMOTED-TO-READY under the mission (serving those criteria) so the Orchestrator build+land daemon picks it up. The conductor decides WHICH criteria to serve; this decides HOW. Model/effort configurable per-project via node_profile_override kind 'planner' (default opus/high), overridable per call. Returns the created epic + leaf ids + the planned spec.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string', description: 'The conductor/owner session creating the work.' }, missionId: { type: 'string', description: 'The mission the epic homes under.' }, criterionIds: { type: 'array', items: { type: 'string' }, description: 'The acceptance criteria this ONE epic should serve (a right-sized epic may serve several related criteria).' }, model: { type: 'string', description: 'Per-call model override (else node_profile_override[planner] → opus).' }, effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'], description: 'Per-call effort override (else node_profile_override[planner] → high).' }, decompositionHint: { type: 'string', description: 'Re-decomposition hint for the planner prompt when a previous epic for this criterion churned.' } }, required: ['project', 'session', 'missionId', 'criterionIds'] } },
      { name: 'set_active_mission', description: "Make ONE mission the ACTIVE mission for its PROJECT — the human 'drive this one instead' override for which mission the conductor drives. A project has at most one active mission, so this deactivates every OTHER active mission in the same project regardless of which session owns it, and AUTO-ENQUEUES each displaced mission to the back of the project's FIFO queue (active=0 with the next queuePos) — a displaced mission is never orphaned, and stays promotable. Returns the deactivated ids.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' } }, required: ['project', 'todoId'] } },
      { name: 'update_mission', description: "Edit a mission's node — its title (goal), description, and/or budgetUsd (per-mission USD budget ceiling). The role is carried by `kind` and is never written into the title. Loop state (phase/iteration/criteria/verdicts) is untouched.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, title: { type: 'string', description: 'New goal text, bare — no role prefix.' }, description: { type: 'string' }, abandonedAt: { type: ['number', 'null'], description: 'Human-set abandonment stamp (ms epoch); null clears it. Set to mark the mission "done with it".' }, budgetUsd: { type: ['number', 'null'], description: 'Per-mission USD budget ceiling; null clears it to the project default. The ONLY supported mutation surface — do not UPDATE the mission row by hand.' }, actor: { type: 'string', description: 'WHO is changing the budget (required for a budgetUsd change; recorded to the autonomy audit log).' }, reason: { type: 'string', description: 'WHY the budget is changing (recorded to the autonomy audit log).' } }, required: ['project', 'todoId'] } },
      { name: 'delete_mission', description: "Permanently delete a mission — drops the mission work-graph node AND its loop-control state + criteria. Irreversible. Use to remove a mis-created or abandoned mission (vs converge/stop which keep it as a completed record).", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' } }, required: ['project', 'todoId'] } },
      { name: 'update_mission_criterion', description: "Edit an acceptance criterion's TEXT (the assertion). Does not change its met/verdict — use set_mission_criterion for that.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, criterionId: { type: 'string' }, text: { type: 'string' } }, required: ['project', 'criterionId', 'text'] } },
      { name: 'list_missions', description: "List a project's MISSIONS as compact summaries — the counterpart to get_mission (which needs a mission id you may not have yet). DEFAULT returns only OPEN missions: it EXCLUDES terminal (converged/abandoned) and archived missions, so you see just what is still in play. Filters: `activeOnly` = only the mission currently being DRIVEN (active=true — at most one per PROJECT); `session` = narrow to missions whose recorded ownerSession/assigneeSession match (a reporting filter only — a mission belongs to its project, not to a session, and queue/active scoping is per-project); `includeTerminal` = also include converged/abandoned; `includeArchived` = also include archived. Each row: id, shortId, title, status, active, awaitingApproval, ownerSession/assigneeSession, capability {met,total}, mechanical {done,total}, gaps, awaitingVerify, converged. Rows are sorted active-first. Use this to find the id, then call get_mission for full per-criterion actions.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string', description: 'Optional — return only missions owned by / assigned to this session.' }, activeOnly: { type: 'boolean', description: 'Only missions with active=true (the driven one). Default false.' }, includeTerminal: { type: 'boolean', description: 'Include converged/abandoned missions. Default false (open only).' }, includeArchived: { type: 'boolean', description: 'Include archived missions. Default false.' } }, required: ['project'] } },
      { name: 'get_mission', description: 'Read a mission\'s full state: control state, acceptance criteria (each with a DERIVED per-criterion `action`: met|building|verify|discover — serve EVERY discover gap in one pass, one epic per criterion), and the convergence rollup — mechanical (direct [EPIC] children done/total) + capability (criteria met/total) + gaps/awaitingVerify + converged flag.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string', description: 'The mission node id.' } }, required: ['project', 'todoId'] } },
      { name: 'add_mission_criterion', description: 'Add an acceptance criterion (a capability assertion) to a mission. Convergence is reached when every criterion is met (see set_mission_criterion). Returns the created criterion.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, text: { type: 'string' } }, required: ['project', 'todoId', 'text'] } },
      { name: 'set_mission_criterion', description: "Record a VERIFY-gate verdict on a mission acceptance criterion: met/unmet PLUS the `evidence` the judge cited and `verifiedBy` (who judged). This should be filled by an INDEPENDENT check (maker≠checker) that fails CLOSED — do not self-grade the work you did. When a criterion is high-stakes (reopened by land, contested by humans, or approaching serve limits), supply panelVerdicts (≥2 independent lenses) to join them by strict-majority vote; fewer than 2 will error fail-closed. Pass remove=true to delete the criterion instead. Convergence = all criteria met.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, criterionId: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string', description: 'Why the judge ruled this met/unmet (the ground-truth citation).' }, verifiedBy: { type: 'string', description: 'Handle of the independent judge (e.g. the reviewer agent id / role).' }, verifiedAtSha: { type: 'string', description: 'Git sha the verdict was checked against (staleness pin).' }, evidencePaths: { type: 'array', items: { type: 'string' }, description: 'File paths the verdict cited (a later land-diff touching one re-opens this criterion).' }, panelVerdicts: { type: 'array', items: { type: 'object', properties: { lens: { type: 'string' }, met: { type: 'boolean' }, reason: { type: 'string' } }, required: ['lens', 'met', 'reason'] }, description: 'High-stakes verdict panel: array of independent lens verdicts. Required when a criterion is reopened-by-land, contested, or serving ≥2 epics; must have ≥2 verdicts or the call will fail closed.' }, remove: { type: 'boolean', description: 'If true, delete the criterion (ignores met).' } }, required: ['project', 'criterionId'] } },
];

/**
 * Handle a mission-group CallTool invocation. Returns the JSON string result
 * (identical to the original inline setup.ts handler), or `null` if `name` is
 * not a mission tool — in which case the caller falls through to its own switch.
 */
export async function handleMissionTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'create_mission': {
      const { project, session, title, description, criteria, budgetUsd, handoffDocId } = args as {
        project: string; session: string; title: string; description?: string; criteria?: string[];
        budgetUsd?: number | null; handoffDocId?: string | null;
      };
      if (!project || !session || !title) throw new Error('Missing required: project, session, title');
      // Store the BARE goal. `kind` is the only role signal (stage C, decision e852fb0c);
      // stripLabel drops a role bracket an operator may have typed, never a topic tag.
      const missionTitle = stripLabel(title);
      if (!missionTitle) throw new Error('title must be non-empty after stripping the role prefix');
      assertMissionCreationAllowed(project);
      // A mission node is a legitimate top-level root (resolveTodoParent exempts it by
      // `kind`, not by title), so allowOrphan isn't needed — addSessionTodo creates it
      // parentless.
      const node = await addSessionTodo(project, session, missionTitle, undefined, {
        kind: 'mission',
        assigneeSession: session, description,
      });
      upsertMission(project, node.id, { budgetUsd: budgetUsd ?? null, handoffDocId: handoffDocId ?? null });
      // One-active-per-project: if the project is already driving an active mission,
      // enqueue the new one (don't steal focus). Otherwise it stays active.
      if (projectHasActiveMission(project, node.id)) enqueueMission(project, node.id);
      for (const c of criteria ?? []) { if (c.trim()) addCriterion(project, node.id, c); }
      getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session, ownerSession: node.ownerSession, assigneeSession: node.assigneeSession ?? undefined });
      return JSON.stringify({
        node: deriveTodoViews(project, [node])[0],
        mission: getMission(project, node.id),
        criteria: listCriteria(project, node.id),
        rollup: getMissionRollup(project, node.id),
      }, null, 2);
    }
    case 'forge_mission': {
      const { project, ...rest } = args as { project: string } & Record<string, unknown>;
      if (!project) throw new Error('Missing required: project');
      rest.constraints = coerceArrayArg(rest.constraints, 'constraints');
      rest.rejectedAlternatives = coerceArrayArg(rest.rejectedAlternatives, 'rejectedAlternatives');
      const result = await forgeMission(project, rest as any);
      const node: any = result.node;
      getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: (rest as any).session, ownerSession: node.ownerSession, assigneeSession: node.assigneeSession ?? undefined });
      return JSON.stringify(result, null, 2);
    }
    case 'plan_mission_criterion': {
      const { project, session, missionId, criterionIds, model, effort, decompositionHint } = args as { project: string; session: string; missionId: string; criterionIds: string[]; model?: string; effort?: any; decompositionHint?: string };
      if (!project || !session || !missionId || !(criterionIds?.length)) throw new Error('Missing required: project, session, missionId, criterionIds');
      const result = await planMissionCriterion(project, { session, missionId, criterionIds, model, effort, decompositionHint });
      getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session, ownerSession: session, assigneeSession: undefined });
      return JSON.stringify(result, null, 2);
    }
    case 'forge_mission_from_doc': {
      const { project, session, docId, model, effort } = args as { project: string; session: string; docId: string; model?: string; effort?: any };
      if (!project || !session || !docId) throw new Error('Missing required: project, session, docId');
      const result = await forgeMissionFromDoc(project, { session, docId, model, effort });
      const node: any = result.node;
      getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session, ownerSession: node.ownerSession, assigneeSession: node.assigneeSession ?? undefined });
      return JSON.stringify(result, null, 2);
    }
    case 'approve_mission': {
      const { project, todoId, approvedBy } = args as { project: string; todoId: string; approvedBy?: string };
      if (!project || !todoId) throw new Error('Missing required: project, todoId');
      const result = await approveMissionAndConstitution(project, todoId, approvedBy ?? 'human');
      const t = getTodo(project, todoId);
      if (t) getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: t.ownerSession, ownerSession: t.ownerSession, assigneeSession: t.assigneeSession ?? undefined });
      return JSON.stringify({ ...result, rollup: getMissionRollup(project, todoId), constitutionHealth: missionConstitutionHealth(project, todoId) }, null, 2);
    }
    case 'list_missions': {
      const { project, session, activeOnly, includeTerminal, includeArchived } = args as {
        project: string; session?: string; activeOnly?: boolean; includeTerminal?: boolean; includeArchived?: boolean;
      };
      if (!project) throw new Error('Missing required: project');
      const summaries = listMissions(project, { session, includeArchived: !!includeArchived });
      const rows = summaries
        .filter((m) => {
          if (activeOnly && !m.mission.active) return false;
          // Default: open only — drop terminal (converged/abandoned) unless asked.
          if (!includeTerminal && isMissionTerminal(m.mission)) return false;
          return true;
        })
        .map((m) => ({
          id: m.node.id,
          shortId: m.node.id.slice(0, 8),
          title: m.node.title,
          status: m.mission.status ?? m.rollup.status,
          active: m.mission.active,
          awaitingApproval: m.mission.awaitingApprovalSince != null,
          ownerSession: m.ownerSession,
          assigneeSession: m.assigneeSession,
          capability: m.rollup.capability,
          mechanical: m.rollup.mechanical,
          gaps: m.rollup.gaps,
          awaitingVerify: m.rollup.awaitingVerify,
          converged: m.rollup.converged,
          handoffDocId: m.mission.handoffDocId,
        }))
        // Active-first, then most open gaps first, then title — the driven mission on top.
        .sort((a, b) => Number(b.active) - Number(a.active) || b.gaps - a.gaps || a.title.localeCompare(b.title));
      return JSON.stringify({ count: rows.length, missions: rows }, null, 2);
    }
    case 'get_mission': {
      const { project, todoId } = args as { project: string; todoId: string };
      if (!project || !todoId) throw new Error('Missing required: project, todoId');
      const mission = getMission(project, todoId);
      if (!mission) throw new Error(`mission not found: ${todoId}`);
      // getMission resolves a leading-8-hex short id to the full row. listCriteriaWithActions and
      // getMissionRollup now resolve a short id THEMSELVES (mission-store.ts's centralized
      // resolveMissionTodoId helper) — this used to be a hand-rolled workaround here because those
      // sub-queries were keyed on the raw arg and silently returned empty criteria/rollup for a
      // short id; that duplication is gone, so `todoId` (raw) is passed straight through below.
      // getMissionCost/missionConstitutionHealth live outside mission-store.ts and do NOT
      // self-resolve, so those two still need the canonical id explicitly.
      const id = mission.todoId;
      return JSON.stringify({
        // Criteria carry the DERIVED per-criterion `action` ('met'|'building'|'verify'|'discover')
        // + servingEpicState — the conductor serves EVERY 'discover' gap in one pass; the scalar
        // mission.status is only the headline.
        mission, criteria: listCriteriaWithActions(project, todoId), rollup: getMissionRollup(project, todoId),
        cost: getMissionCost(project, id),
        // Enforcement teeth: 'constitution-not-injected' = a mission with a handoff whose locked
        // rules never became active constraint records the builders see (forge_mission prevents this).
        constitutionHealth: missionConstitutionHealth(project, id),
      }, null, 2);
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
      const { project, todoId, title, description, abandonedAt, budgetUsd, actor, reason } = args as {
        project: string; todoId: string; title?: string; description?: string; abandonedAt?: number | null;
        budgetUsd?: number | null; actor?: string; reason?: string;
      };
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
      let budget = getMission(project, todoId)?.budgetUsd ?? null;
      if (budgetUsd !== undefined) {
        budget = setMissionBudget(project, todoId, budgetUsd, { actor: actor ?? 'mcp:update_mission', reason }).budgetUsd;
      }
      return JSON.stringify({ todoId, title: updated.title, description: updated.description, abandonedAt: abandoned, budgetUsd: budget }, null, 2);
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
      const { project, criterionId, met, evidence, verifiedBy, verifiedAtSha, evidencePaths, remove, panelVerdicts } = args as {
        project: string; criterionId: string; met?: boolean; evidence?: string; verifiedBy?: string; verifiedAtSha?: string; evidencePaths?: string[]; remove?: boolean; panelVerdicts?: { lens: string; met: boolean; reason: string }[];
      };
      // The MCP bridge marshals an array-OF-OBJECTS argument (panelVerdicts) to the handler as a
      // JSON STRING for some clients — array-of-strings params (evidencePaths) pass through as real
      // arrays, so only this one is affected. normalizePanelVerdicts coerces + validates fail-closed.
      // Without it a high-stakes verdict is UNRECORDABLE through MCP: `panelVerdicts?.length` reads the
      // string's CHAR length (≥2 → spuriously clears the panel gate), then joinPanelVerdicts calls
      // .filter on a string and throws. That wedged auto-close for every converged mission with a
      // reopened-by-land criterion (missions f1404796 / 48e1a624 / 245a679b / fb417397 …) and blocked
      // any external maker≠checker verifier (the in-process conductor was unaffected — it passes a real
      // array — which is why it went unseen).
      const panelVerdictsArr = normalizePanelVerdicts(panelVerdicts);
      if (!project || !criterionId) throw new Error('Missing required: project, criterionId');
      if (remove) { removeCriterion(project, criterionId); return JSON.stringify({ removed: criterionId }, null, 2); }
      if (typeof met !== 'boolean') throw new Error('met (boolean) is required unless remove=true');

      // Panel enforcement: when met=true, check if this criterion is high-stakes.
      let panel = false;
      let trigger: string | null = null;
      let recordedMet = met;

      if (met === true) {
        const stakes = classifyVerifyStakes(collectVerifyStakesInput(project, criterionId));
        panel = stakes.panel;
        trigger = stakes.trigger;

        if (panel) {
          // High-stakes criterion requires a panel verdict. Fail closed if insufficient verdicts.
          // Count off the coerced/validated array (never a raw string — see the normalization above).
          const verdictCount = Array.isArray(panelVerdictsArr) ? panelVerdictsArr.length : 0;
          if (verdictCount < 2) {
            throw new Error(`High-stakes criterion (trigger=${trigger}) requires ≥2 panel verdicts (lenses: ${VERIFY_LENSES.join(', ')}); received ${verdictCount}`);
          }

          // Join the panel verdicts by strict-majority vote.
          const join = joinPanelVerdicts(panelVerdictsArr as PanelVerdict[]);
          recordedMet = join.met;

          // Compose evidence with dissent if split.
          let finalEvidence = evidence ?? '';
          if (join.split && join.dissent) {
            finalEvidence = finalEvidence ? `${finalEvidence}\n\nPANEL DISSENT (trigger=${trigger}): ${join.dissent}` : `PANEL DISSENT (trigger=${trigger}): ${join.dissent}`;
          }

          // Panel path always calls setCriterionVerdict to record the full verdict details.
          setCriterionVerdict(project, criterionId, { met: recordedMet, evidence: finalEvidence, verifiedBy, verifiedAtSha, evidencePaths });
        } else {
          // No high-stakes trigger — use the existing single-verdict path.
          if (evidence !== undefined || verifiedBy !== undefined || verifiedAtSha !== undefined || evidencePaths !== undefined) {
            setCriterionVerdict(project, criterionId, { met, evidence, verifiedBy, verifiedAtSha, evidencePaths });
          } else {
            setCriterionMet(project, criterionId, met);
          }
        }
      } else {
        // met=false never convenes a panel — use the existing path.
        if (evidence !== undefined || verifiedBy !== undefined || verifiedAtSha !== undefined || evidencePaths !== undefined) {
          setCriterionVerdict(project, criterionId, { met, evidence, verifiedBy, verifiedAtSha, evidencePaths });
        } else {
          setCriterionMet(project, criterionId, met);
        }
      }

      return JSON.stringify({ criterionId, met: recordedMet, evidence: evidence ?? null, verifiedBy: verifiedBy ?? null, verifiedAtSha: verifiedAtSha ?? null, evidencePaths: evidencePaths ?? [], panel, trigger }, null, 2);
    }
    default:
      return null;
  }
}
