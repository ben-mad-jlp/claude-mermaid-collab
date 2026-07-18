/**
 * mission-planner — the PLANNER node (Phase 3 of the autonomous conductor). The conductor decides
 * WHICH criteria to serve; the planner decides HOW: it decomposes one-or-more acceptance criteria
 * into ONE right-sized epic + its leaves (with deps), grounded against the real code, and
 * instantiates it PROMOTED-TO-READY so the Orchestrator build+land daemon can pick it up. Separating
 * planning (a specialist per-tick node) from conducting keeps each node focused — the conductor
 * DELEGATES to this via `plan_mission_criterion`, so planning is not done inline while also verifying
 * and landing.
 *
 * Mirrors the forge pattern: node emits a structured spec, deterministic code instantiates it (via
 * createEpicWithLandLeaf + addLeavesToEpic). Injectable invoke/resolveCriteria for tests.
 */
import { invokeNode, mcpConfigFor, type NodeSpec, type NodeResult } from '../../agent/node-invoker.js';
import { resolveNodeModel, resolveNodeProvider, resolveOrchestrationEffort } from '../../services/node-provider.js';
import { config } from '../../config.js';
import type { EffortLevel } from '../../agent/contracts.js';
import { listCriteria } from '../../services/mission-store.js';
import { updateTodo, type Todo } from '../../services/todo-store.js';
import { createEpicWithLandLeaf, addLeavesToEpic } from '../workgraph-tools.js';
import { ORCHESTRATION_NODE_PROFILE } from '../../services/node-kinds.js';

export interface PlannedLeaf {
  title: string;
  description?: string;
  files?: string[];
  /** Intra-batch positional deps ("$0","$1",…) or existing todo ids. */
  dependsOn?: string[];
}
export interface EpicSpec {
  title: string;
  description?: string;
  leaves: PlannedLeaf[];
}

/** The planner NODE prompt: decompose the given criteria into ONE right-sized epic + leaves. */
export function buildPlannerPrompt(project: string, missionId: string, criteria: { id: string; text: string }[]): string {
  return [
    `You are the PLANNER node for project ${project}, mission ${missionId}. Decompose the acceptance`,
    'criteria below into ONE right-sized EPIC and its LEAVES (the units the build daemon will',
    'implement). READ-ONLY: use Read/Grep/Glob/Bash and the graph tools to GROUND the plan in the real',
    'code and to avoid re-planning work that already exists. Do NOT create anything or edit source.',
    '',
    'CRITERIA this epic must serve:',
    ...criteria.map((c) => `- (${c.id}) ${c.text}`),
    '',
    'DISCIPLINE:',
    '- ONE epic for these criteria (a right-sized epic MAY serve several related criteria). Prefer a',
    '  few COUPLED leaves over many thin ones; split only along genuine independence boundaries.',
    '- Each leaf is ONE unit of work with a concrete, buildable scope. Give it a clear title, a',
    '  description naming the real files/symbols to touch and the change shape, and the files it edits.',
    '- Order leaves by dependency; a leaf that needs an earlier one lists it in `dependsOn` using its',
    '  positional token ("$0" = the first leaf in this list, "$1" = second, …).',
    '- Do NOT plan a [LAND] leaf — landing is handled separately.',
    '',
    'Emit EXACTLY ONE JSON object as your FINAL reply (optionally in a ```json fence), nothing after it:',
    '{',
    '  "title": "<epic goal, bare — no role prefix>",',
    '  "description": "<what this epic delivers, one or two sentences>",',
    '  "leaves": [ { "title": "<leaf>", "description": "<files/symbols + change shape>",',
    '               "files": ["<path>"], "dependsOn": ["$0"] } ]',
    '}',
  ].join('\n');
}

/** Extract + validate the epic spec from the planner node's final text. */
export function parseEpicSpec(text: string): EpicSpec {
  const t = (text ?? '').trim();
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  let jsonStr = fenced && fenced[1].includes('{') ? fenced[1] : t;
  if (!fenced) {
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first >= 0 && last > first) jsonStr = jsonStr.slice(first, last + 1);
  }
  let raw: any;
  try { raw = JSON.parse(jsonStr.trim()); } catch (e) {
    throw new Error(`planner node emitted no parseable epic-spec JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) throw new Error('planner epic-spec is missing a title');
  const leaves = Array.isArray(raw.leaves)
    ? raw.leaves.filter((l: any) => l && typeof l.title === 'string' && l.title.trim())
    : [];
  if (leaves.length === 0) throw new Error('planner epic-spec has no leaves (nothing to build)');
  return {
    title: raw.title,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    leaves: leaves.map((l: any) => ({
      title: l.title,
      description: typeof l.description === 'string' ? l.description : undefined,
      files: Array.isArray(l.files) ? l.files.filter((f: unknown) => typeof f === 'string') : undefined,
      dependsOn: Array.isArray(l.dependsOn) ? l.dependsOn.filter((d: unknown) => typeof d === 'string') : undefined,
    })),
  };
}

export interface PlanCriterionInput {
  session: string;
  missionId: string;
  /** The acceptance criteria this epic should serve (the conductor's grouping). */
  criterionIds: string[];
  model?: string;
  effort?: EffortLevel;
}
export interface PlanCriterionDeps {
  invoke?: (spec: NodeSpec) => Promise<NodeResult>;
  resolveCriteria?: (project: string, missionId: string, criterionIds: string[]) => { id: string; text: string }[];
}
export interface PlanCriterionResult {
  epicId: string;
  epic: Todo;
  leafIds: string[];
  spec: EpicSpec;
  modelUsed: string;
  effortUsed: EffortLevel;
}

function defaultResolveCriteria(project: string, missionId: string, criterionIds: string[]): { id: string; text: string }[] {
  const want = new Set(criterionIds);
  return listCriteria(project, missionId).filter((c) => want.has(c.id)).map((c) => ({ id: c.id, text: c.text }));
}

/** Plan ONE epic (serving the given criteria) via a specialist planner NODE, and instantiate it
 *  PROMOTED-TO-READY under the mission so the build daemon can pick it up. */
export async function planMissionCriterion(
  project: string,
  input: PlanCriterionInput,
  deps: PlanCriterionDeps = {},
): Promise<PlanCriterionResult> {
  if (!project || !input.session || !input.missionId || !(input.criterionIds?.length)) {
    throw new Error('plan_mission_criterion: project, session, missionId, and criterionIds are required');
  }
  const criteria = (deps.resolveCriteria ?? defaultResolveCriteria)(project, input.missionId, input.criterionIds);
  if (criteria.length === 0) throw new Error('plan_mission_criterion: none of the criterionIds match this mission');

  const provider = resolveNodeProvider(project, 'planner', ORCHESTRATION_NODE_PROFILE.planner.allowedTools);
  const model = input.model ?? resolveNodeModel(project, 'planner', provider, ORCHESTRATION_NODE_PROFILE.planner.model);
  const effort: EffortLevel = input.effort ?? resolveOrchestrationEffort(project, 'planner');

  const res = await (deps.invoke ?? invokeNode)({
    prompt: buildPlannerPrompt(project, input.missionId, criteria),
    model,
    effort,
    allowedTools: ORCHESTRATION_NODE_PROFILE.planner.allowedTools,
    mcpConfig: mcpConfigFor(config.PORT),
    strictMcpConfig: true,
    cwd: project,
    project,
    permissionMode: 'bypassPermissions',
    transcriptLabel: 'planner',
  });
  if (!res.ok || !res.text || !res.text.trim()) {
    throw new Error(`plan_mission_criterion: the planner node failed or returned no text${res.rateLimited ? ' (rate-limited)' : ''}`);
  }
  const spec = parseEpicSpec(res.text);

  // Instantiate: one epic homed to the mission, serving the criteria, with its leaves promoted to
  // READY (claimable by the daemon). Approve the epic (status:'ready' stamps approvedAt; the
  // servesCriterionIds edge satisfies the mission-homed approval guard).
  const { epic } = await createEpicWithLandLeaf(project, input.session, {
    title: spec.title,
    description: spec.description,
    home: input.missionId,
    homeProvided: true,
    servesCriterionIds: input.criterionIds,
  });
  const { createdIds } = await addLeavesToEpic(
    project,
    input.session,
    epic.id,
    spec.leaves.map((l) => ({ title: l.title, description: l.description, files: l.files, dependsOn: l.dependsOn, status: 'ready' as const })),
  );
  await updateTodo(project, epic.id, { status: 'ready' }); // approve the epic for the daemon

  return { epicId: epic.id, epic, leafIds: createdIds, spec, modelUsed: model, effortUsed: effort };
}
