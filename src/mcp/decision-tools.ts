// Decision/spec/cartographer MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the DECISION tool group: creating/approving/superseding decision records,
// constraint/requirement management, spec coverage, cartographer health/sync,
// system objects, and graph drift detection. Assembled from exact byte ranges of
// setup.ts — behavior is identical, a pure move.
import {
  createDecisionRecord,
  listDecisionRecords,
  approveDecisionRecord,
  supersedeDecisionRecord,
  getActiveConstraints,
  getActiveRequirements,
  type DecisionKind,
  type RequirementSpec,
} from '../services/decision-record-store.js';
import {
  listObjects,
  listTypes,
} from '../services/system-object-store.js';
import {
  bom,
} from '../services/system-object-bom.js';
import {
  specCoverage,
  decideRequirement,
  type RequirementDecision,
} from '../services/spec-coverage.js';
import {
  specHealth,
  syncShortlist,
} from '../services/cartographer.js';
import {
  checkGraphDrift,
  type DriftNode,
} from '../services/graph-drift.js';
import {
  getTodo,
  completeGatesForDecision,
} from '../services/todo-store.js';
import {
  getWebSocketHandler,
} from '../services/ws-handler-manager.js';
import {
  getTaskGraphTasks,
} from './workflow/task-sync.js';

export const DECISION_TOOL_DEFS = [
  { name: 'create_decision_record', description: 'Create a decision record (constraint, requirement, assumption, risk, or metric). Spec on WHAT and WHY; rationale is grounded (link source docs). One-time proposal; approval/supersession via separate tools.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, kind: { type: 'string', enum: ['constraint', 'requirement', 'assumption', 'risk', 'metric'] }, title: { type: 'string' }, rationale: { type: 'string', description: 'Why — cited references strongly preferred.' }, alternatives: { type: 'array', items: { type: 'string' }, description: 'What was considered and rejected.' }, spec: { type: 'object', description: 'Requirement metric {metric, op, target}.', properties: { metric: { type: 'string' }, op: { type: 'string' }, target: {} } }, linkedTodos: { type: 'array', items: { type: 'string' }, description: 'Todo ids this record gates.' }, epicId: { type: 'string' }, authorSession: { type: 'string', description: 'Session of the creator (recorded for provenance).' } }, required: ['project', 'kind', 'title'] } },
  { name: 'list_decision_records', description: 'List decision records for a project — filter by status (proposed/approved/active/superseded), kind, or epicId. Empty result when no matches; no error on unknown filters (gracefully empty). Read-only.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, epicId: { type: 'string', description: 'Filter by epic.' }, kind: { type: 'string', enum: ['constraint', 'requirement', 'assumption', 'risk', 'metric'], description: 'Filter by decision kind.' }, status: { type: 'string', enum: ['proposed', 'approved', 'active', 'superseded'], description: 'Filter by status.' } }, required: ['project'] } },
  { name: 'approve_decision_record', description: 'Approve a proposed decision record (activate it). Fires the readiness-gate callback (any gated todo auto-completed on the same tick). Idempotent on already-approved records.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, id: { type: 'string' }, approvedBy: { type: 'string', description: 'Approver handle.' } }, required: ['project', 'id', 'approvedBy'] } },
  { name: 'supersede_decision_record', description: 'Mark one decision as superseded-by another (e.g. a requirement is re-signed with a tighter spec). Both records remain queryable (full audit trail).', inputSchema: { type: 'object', properties: { project: { type: 'string' }, id: { type: 'string' }, bySupersedingId: { type: 'string', description: 'The new/replacement record id.' } }, required: ['project', 'id', 'bySupersedingId'] } },
  { name: 'get_active_constraints', description: 'Active constraints in scope for an epic (epic-level + project-level). Omit epicId for all active constraints.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, epicId: { type: 'string' } }, required: ['project'] } },
  { name: 'get_active_requirements', description: 'Active requirements in scope for an epic (epic-level + project-level) — the spec→Planner bridge, peer of get_active_constraints. Omit epicId for all active requirements.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, epicId: { type: 'string' } }, required: ['project'] } },
  { name: 'spec_coverage', description: 'Spec coverage rollup (design-system-object-ui §5): for each durable system object, is it covered/partial/uncovered, derived inline from the Todo.objectRef join (no full-tree walk). Returns { total, covered, partial, uncovered, byObject[] }.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } },
  { name: 'cartographer_health', description: 'Cartographer spec-health summary (design-cartographer §8, Phase 1): read-only counts { uncoveredRequirements, orphanObjects, staleEdges }. Proposes nothing; never writes.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } },
  { name: 'cartographer_sync', description: 'Cartographer drift sync (design-cartographer §3/§6, Phase 1): runs the deterministic detectors then ranks (drift > inverse-coverage), dedupes by object, and caps to the top 5 — the pre-write batch sheet the human approves per-line in the Inbox later. ZERO DB writes. Quiet-by-default: nothing drifted → { inSync: true, message: "spec in sync" }.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } },
  { name: 'list_system_objects', description: 'List the durable system-object tree (instances) + the type registry for a project — the data the Spec Sheet renders.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } },
  { name: 'system_object_bom', description: 'Rolled-up bill-of-materials beneath a root object (derived recursive-CTE; never stored): total qty per child type.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, rootId: { type: 'string' } }, required: ['project', 'rootId'] } },
  { name: 'decide_requirement', description: 'Sign/reject/re-sign a requirement promise (reuses the decision-record approve/supersede path). decision: "approve" → active; "reject" → superseded (no replacement); "edit" → creates a fresh proposed requirement carrying the new spec and supersedes the old (the re-sign DIFF). edit requires spec.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, id: { type: 'string' }, decision: { type: 'string', enum: ['approve', 'reject', 'edit'] }, approvedBy: { type: 'string' }, spec: { type: 'object', description: 'New requirement spec {metric, op, target} — required for decision="edit".', properties: { metric: { type: 'string' }, op: { type: 'string' }, target: {} } }, title: { type: 'string' } }, required: ['project', 'id', 'decision'] } },
  { name: 'check_graph_drift', description: 'Graph↔code drift check: scans the session\'s blueprint task files and flags MISSING dependencies — where one task\'s code imports another task\'s files but the plan graph has no dependsOn. Deterministic (import-edge analysis, no LLM). The supervisor can run this periodically.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' } }, required: ['project', 'session'] } },
];

export async function handleDecisionTool(name: string, args: any): Promise<string | null> {
  switch (name) {
    case 'create_decision_record': {
      const { project, kind, title, rationale, alternatives, spec, linkedTodos, epicId, authorSession } = args as { project: string; kind: DecisionKind; title: string; rationale?: string; alternatives?: string[]; spec?: RequirementSpec; linkedTodos?: string[]; epicId?: string; authorSession?: string };
      if (!project || !kind || !title) throw new Error('Missing required: project, kind, title');
      return JSON.stringify(createDecisionRecord(project, { kind, title, rationale, alternatives, spec, linkedTodos, epicId: epicId ?? null, authorSession }), null, 2);
    }
    case 'list_decision_records': {
      const { project, epicId, kind, status } = args as { project: string; epicId?: string; kind?: DecisionKind; status?: 'proposed' | 'approved' | 'active' | 'superseded' };
      if (!project) throw new Error('Missing required: project');
      const filter: { epicId?: string; kind?: DecisionKind; status?: 'proposed' | 'approved' | 'active' | 'superseded' } = {};
      if (epicId !== undefined) filter.epicId = epicId;
      if (kind) filter.kind = kind;
      if (status) filter.status = status;
      return JSON.stringify({ records: listDecisionRecords(project, filter) }, null, 2);
    }
    case 'approve_decision_record': {
      const { project, id, approvedBy } = args as { project: string; id: string; approvedBy: string };
      if (!project || !id || !approvedBy) throw new Error('Missing required: project, id, approvedBy');
      const rec = approveDecisionRecord(project, id, approvedBy);
      if (!rec) throw new Error(`decision record not found: ${id}`);
      const clearedGates = await completeGatesForDecision(project, id);
      if (clearedGates.length > 0) getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
      return JSON.stringify({ ...rec, clearedGates: clearedGates.map((r) => ({ gate: r.completed.id, promoted: r.promoted })) }, null, 2);
    }
    case 'supersede_decision_record': {
      const { project, id, bySupersedingId } = args as { project: string; id: string; bySupersedingId: string };
      if (!project || !id || !bySupersedingId) throw new Error('Missing required: project, id, bySupersedingId');
      const rec = supersedeDecisionRecord(project, id, bySupersedingId);
      if (!rec) throw new Error(`decision record not found: ${id}`);
      return JSON.stringify(rec, null, 2);
    }
    case 'get_active_constraints': {
      const { project, epicId } = args as { project: string; epicId?: string };
      if (!project) throw new Error('Missing required: project');
      return JSON.stringify({ constraints: getActiveConstraints(project, epicId) }, null, 2);
    }
    case 'get_active_requirements': {
      const { project, epicId } = args as { project: string; epicId?: string };
      if (!project) throw new Error('Missing required: project');
      return JSON.stringify({ requirements: getActiveRequirements(project, epicId) }, null, 2);
    }
    case 'spec_coverage': {
      const { project } = args as { project: string };
      if (!project) throw new Error('Missing required: project');
      return JSON.stringify({ coverage: specCoverage(project) }, null, 2);
    }
    case 'cartographer_health': {
      const { project } = args as { project: string };
      if (!project) throw new Error('Missing required: project');
      return JSON.stringify({ health: specHealth(project) }, null, 2);
    }
    case 'cartographer_sync': {
      const { project } = args as { project: string };
      if (!project) throw new Error('Missing required: project');
      return JSON.stringify(syncShortlist(project), null, 2);
    }
    case 'list_system_objects': {
      const { project } = args as { project: string };
      if (!project) throw new Error('Missing required: project');
      return JSON.stringify({ objects: listObjects(project), types: listTypes(project) }, null, 2);
    }
    case 'system_object_bom': {
      const { project, rootId } = args as { project: string; rootId: string };
      if (!project || !rootId) throw new Error('Missing required: project, rootId');
      return JSON.stringify({ lines: bom(project, rootId) }, null, 2);
    }
    case 'decide_requirement': {
      const { project, id, decision, approvedBy, spec, title } = args as { project: string; id: string; decision: RequirementDecision; approvedBy?: string; spec?: RequirementSpec; title?: string };
      if (!project || !id || !decision) throw new Error('Missing required: project, id, decision');
      return JSON.stringify(decideRequirement(project, { id, decision, approvedBy, spec, title }), null, 2);
    }
    case 'check_graph_drift': {
      const { project, session } = args as { project: string; session: string };
      if (!project || !session) throw new Error('Missing required: project, session');
      const tasks = await getTaskGraphTasks(project, session);
      const nodes: DriftNode[] = tasks.map((t) => ({ id: t.id, dependsOn: t['depends-on'] ?? [], files: t.files ?? [], title: t.id }));
      const findings = checkGraphDrift(project, nodes);
      return JSON.stringify({ findings, tasksScanned: nodes.length }, null, 2);
    }
    default:
      return null;
  }
}
