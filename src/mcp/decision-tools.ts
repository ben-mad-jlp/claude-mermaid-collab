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
  {"name":"create_decision_record","description":"Record a planning decision/constraint/assumption/requirement (PCS #9). decisions/assumptions are auto-active; constraints & requirements start \"proposed\" and need approval. requirements carry a machine-checkable spec {metric,op,target}. epicId null = project-level.","inputSchema":{"properties":{"alternatives":{"items":{"type":"string"},"type":"array"},"authorSession":{"type":"string"},"epicId":{"description":"Epic id, or omit for project-level.","type":"string"},"kind":{"enum":["decision","constraint","assumption","requirement"],"type":"string"},"linkedTodos":{"items":{"type":"string"},"type":"array"},"project":{"type":"string"},"rationale":{"type":"string"},"spec":{"description":"Requirement spec {metric, op, target} — only for kind=\"requirement\".","properties":{"metric":{"type":"string"},"op":{"type":"string"},"target":{}},"type":"object"},"title":{"type":"string"}},"required":["project","kind","title"],"type":"object"}},
  {"name":"list_decision_records","description":"List decision records for a project, filterable by epicId / kind / status.","inputSchema":{"properties":{"epicId":{"type":"string"},"kind":{"enum":["decision","constraint","assumption","requirement"],"type":"string"},"project":{"type":"string"},"status":{"enum":["proposed","approved","active","superseded"],"type":"string"}},"required":["project"],"type":"object"}},
  {"name":"approve_decision_record","description":"Approve a proposed constraint or requirement (human gate) → active.","inputSchema":{"properties":{"approvedBy":{"type":"string"},"id":{"type":"string"},"project":{"type":"string"}},"required":["project","id","approvedBy"],"type":"object"}},
  {"name":"supersede_decision_record","description":"Mark a decision record superseded by another (the superseding record should already exist).","inputSchema":{"properties":{"bySupersedingId":{"type":"string"},"id":{"type":"string"},"project":{"type":"string"}},"required":["project","id","bySupersedingId"],"type":"object"}},
  {"name":"get_active_constraints","description":"Active constraints in scope for an epic (epic-level + project-level) — the decision-record half of /focus. Omit epicId for all active constraints.","inputSchema":{"properties":{"epicId":{"type":"string"},"project":{"type":"string"}},"required":["project"],"type":"object"}},
  {"name":"get_active_requirements","description":"Active requirements in scope for an epic (epic-level + project-level) — the spec→Planner bridge, peer of get_active_constraints. Omit epicId for all active requirements.","inputSchema":{"properties":{"epicId":{"type":"string"},"project":{"type":"string"}},"required":["project"],"type":"object"}},
  {"name":"spec_coverage","description":"Spec coverage rollup (design-system-object-ui §5): for each durable system object, is it covered/partial/uncovered, derived inline from the Todo.objectRef join (no full-tree walk). Returns { total, covered, partial, uncovered, byObject[] }.","inputSchema":{"properties":{"project":{"type":"string"}},"required":["project"],"type":"object"}},
  {"name":"cartographer_health","description":"Cartographer spec-health summary (design-cartographer §8, Phase 1): read-only counts { uncoveredRequirements, orphanObjects, staleEdges }. Proposes nothing; never writes.","inputSchema":{"properties":{"project":{"type":"string"}},"required":["project"],"type":"object"}},
  {"name":"cartographer_sync","description":"Cartographer drift sync (design-cartographer §3/§6, Phase 1): runs the deterministic detectors then ranks (drift > inverse-coverage), dedupes by object, and caps to the top 5 — the pre-write batch sheet the human approves per-line in the Inbox later. ZERO DB writes. Quiet-by-default: nothing drifted → { inSync: true, message: \"spec in sync\" }.","inputSchema":{"properties":{"project":{"type":"string"}},"required":["project"],"type":"object"}},
  {"name":"list_system_objects","description":"List the durable system-object tree (instances) + the type registry for a project — the data the Spec Sheet renders.","inputSchema":{"properties":{"project":{"type":"string"}},"required":["project"],"type":"object"}},
  {"name":"system_object_bom","description":"Rolled-up bill-of-materials beneath a root object (derived recursive-CTE; never stored): total qty per child type.","inputSchema":{"properties":{"project":{"type":"string"},"rootId":{"type":"string"}},"required":["project","rootId"],"type":"object"}},
  {"name":"decide_requirement","description":"Sign/reject/re-sign a requirement promise (reuses the decision-record approve/supersede path). decision: \"approve\" → active; \"reject\" → superseded (no replacement); \"edit\" → creates a fresh proposed requirement carrying the new spec and supersedes the old (the re-sign DIFF). edit requires spec.","inputSchema":{"properties":{"approvedBy":{"type":"string"},"decision":{"enum":["approve","reject","edit"],"type":"string"},"id":{"type":"string"},"project":{"type":"string"},"spec":{"description":"New requirement spec {metric, op, target} — required for decision=\"edit\".","properties":{"metric":{"type":"string"},"op":{"type":"string"},"target":{}},"type":"object"},"title":{"type":"string"}},"required":["project","id","decision"],"type":"object"}},
  {"name":"check_graph_drift","description":"Graph↔code drift check: scans the session's blueprint task files and flags MISSING dependencies — where one task's code imports another task's files but the plan graph has no dependsOn. Deterministic (import-edge analysis, no LLM). The supervisor can run this periodically.","inputSchema":{"properties":{"project":{"type":"string"},"session":{"type":"string"}},"required":["project","session"],"type":"object"}},
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
