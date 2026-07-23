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
import { listCriteria, listCriteriaWithActions, CHILDLESS_SERVE_GRACE_MS, type CriterionAction } from '../../services/mission-store.js';
import { listTodos, updateTodo, type Todo } from '../../services/todo-store.js';
import { createEpicWithLandLeaf, addLeavesToEpic } from '../workgraph-tools.js';
import { ORCHESTRATION_NODE_PROFILE } from '../../services/node-kinds.js';
import { isEpic } from '../../services/todo-kind.js';

export class ServeIntegrityError extends Error {
  readonly code = 'serve-integrity';
  constructor(
    readonly criterionId: string,
    readonly derivedAction: CriterionAction,
    readonly servingEpicId: string | undefined,
    readonly servingEpicTitle: string | undefined,
    readonly servingEpicState: 'landed' | 'open' | 'none',
  ) {
    const epicInfo = servingEpicId && servingEpicTitle
      ? `epic ${servingEpicId.slice(0, 8)} ("${servingEpicTitle}")`
      : 'a serving epic';
    super(
      `plan_mission_criterion refused: criterion ${criterionId.slice(0, 8)} is already being served by ${epicInfo} — ` +
      `derived action is '${derivedAction}' (servingEpicState: ${servingEpicState}), not 'discover'.`,
    );
    this.name = 'ServeIntegrityError';
  }
}

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

/** Extract the first brace-BALANCED JSON object from a blob, tracking string literals +
 *  escapes so a `}` inside a string value never truncates the slice. The old naive
 *  `lastIndexOf('}')` cut at a `}` embedded in a description string, leaving an unterminated
 *  string — the deterministic `JSON Parse error: Unterminated string` the planner tripped on.
 *  Returns null when no balanced object closes (a truncated / cut-off emission), so the caller
 *  can distinguish "malformed" from "truncated" and retry. */
export function extractBalancedJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { if (--depth === 0) return s.slice(start, i + 1); }
  }
  return null; // never balanced ⇒ truncated / unterminated
}

/** Extract + validate the epic spec from the planner node's final text. */
export function parseEpicSpec(text: string): EpicSpec {
  const t = (text ?? '').trim();
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  const source = fenced && fenced[1].includes('{') ? fenced[1] : t;
  const jsonStr = extractBalancedJsonObject(source);
  if (jsonStr == null) {
    throw new Error('planner node emitted no complete JSON object (truncated or unbalanced)');
  }
  let raw: any;
  try { raw = JSON.parse(jsonStr); } catch (e) {
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
  resolveActions?: typeof listCriteriaWithActions;
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

/** Find the live serving epic for a criterion, if any. Filters todos by
 *  servesCriterionId/servesCriterionIds match and epic status, returning the id + title
 *  or undefined if no serving epic exists. */
function findServingEpic(
  project: string,
  criterionId: string,
  servingEpicState: 'landed' | 'open' | 'none',
): { id: string; title: string } | undefined {
  if (servingEpicState === 'none') return undefined;
  const allTodos = listTodos(project, { includeCompleted: true });
  for (const todo of allTodos) {
    if (!isEpic(todo) || todo.status === 'dropped') continue;
    const serves = todo.servesCriterionId === criterionId || (todo.servesCriterionIds ?? []).includes(criterionId);
    if (!serves) continue;
    if (servingEpicState === 'landed' && todo.status === 'done') return { id: todo.id, title: todo.title };
    if (servingEpicState === 'open' && todo.status !== 'done') return { id: todo.id, title: todo.title };
  }
  return undefined;
}

/** Find a recent non-dropped serving epic created within CHILDLESS_SERVE_GRACE_MS of now.
 *  Returns the newest-createdAt match or undefined. */
function findRecentServingEpic(
  project: string,
  criterionId: string,
  now: number,
): { id: string; title: string; status: Todo['status'] } | undefined {
  const allTodos = listTodos(project, { includeCompleted: true });
  let newest: { id: string; title: string; status: Todo['status']; createdAt: number } | undefined;
  for (const todo of allTodos) {
    if (!isEpic(todo) || todo.status === 'dropped') continue;
    const serves = todo.servesCriterionId === criterionId || (todo.servesCriterionIds ?? []).includes(criterionId);
    if (!serves) continue;
    const createdMs = Date.parse(todo.createdAt);
    if (!Number.isFinite(createdMs)) continue;
    if (now - createdMs < CHILDLESS_SERVE_GRACE_MS) {
      if (!newest || createdMs > newest.createdAt) {
        newest = { id: todo.id, title: todo.title, status: todo.status, createdAt: createdMs };
      }
    }
  }
  return newest ? { id: newest.id, title: newest.title, status: newest.status } : undefined;
}

/** In-flight reservation state: dedupe concurrent/retried serves for the same criterion.
 *  The key is project|missionId|criterionId; the value is the Promise awaiting the epic
 *  creation. When a client retries after a perceived timeout, it finds the key still reserved
 *  and piggybacks on the original promise. */
const inFlightServes = new Map<string, Promise<PlanCriterionResult>>();
function reservationKey(project: string, missionId: string, criterionId: string): string {
  return `${project}|${missionId}|${criterionId}`;
}

/** Serve-integrity guard: refuse if any requested criterion is already being served
 *  (not in 'discover' state) or was recently created. Prevents duplicate serving epics on
 *  stale mission snapshots. */
function assertServeIntegrity(
  project: string,
  missionId: string,
  criterionIds: string[],
  resolveActions: typeof listCriteriaWithActions,
): void {
  const now = Date.now();
  const actions = resolveActions(project, missionId);
  const byId = new Map(actions.map((a) => [a.id, a]));
  for (const criterionId of criterionIds) {
    const action = byId.get(criterionId);
    if (action && action.action !== 'discover') {
      const serving = findServingEpic(project, criterionId, action.servingEpicState);
      throw new ServeIntegrityError(
        criterionId,
        action.action,
        serving?.id,
        serving?.title,
        action.servingEpicState,
      );
    }
    const recent = findRecentServingEpic(project, criterionId, now);
    if (recent) {
      throw new ServeIntegrityError(
        criterionId,
        action?.action ?? 'discover',
        recent.id,
        recent.title,
        recent.status === 'done' ? 'landed' : 'open',
      );
    }
  }
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

  // First serve-integrity guard: refuse if any requested criterion is already being served.
  const resolveActions = deps.resolveActions ?? listCriteriaWithActions;
  assertServeIntegrity(project, input.missionId, input.criterionIds, resolveActions);

  // In-flight reservation: dedupe concurrent/retried serves for the same criteria.
  // Compute reservation keys; if any are already in-flight, return the existing promise.
  const keys = input.criterionIds.map((id) => reservationKey(project, input.missionId, id));
  for (const key of keys) {
    const existing = inFlightServes.get(key);
    if (existing) return existing;
  }

  // Wrap the remaining body in a promise, store it under all keys, and clear on completion.
  const promise = (async () => {
    const provider = resolveNodeProvider(project, 'planner', ORCHESTRATION_NODE_PROFILE.planner.allowedTools);
    const model = input.model ?? resolveNodeModel(project, 'planner', provider, ORCHESTRATION_NODE_PROFILE.planner.model);
    const effort: EffortLevel = input.effort ?? resolveOrchestrationEffort(project, 'planner');

    // Invoke the planner with ONE repair retry: a truncated/malformed final-reply JSON must not
    // fail the whole serve (that failure is what wedges the conductor — see conductor-pass.ts). On a
    // parse failure, re-ask ONCE for compact, escaped, prose-free JSON with terser leaf descriptions.
    const basePrompt = buildPlannerPrompt(project, input.missionId, criteria);
    const REPAIR_SUFFIX =
      '\n\nIMPORTANT: your FINAL reply must be ONLY the single JSON object — compact, on as few lines ' +
      'as possible, every string properly escaped (no literal newline inside a string, no unescaped ' +
      'quote or brace-breaking content), no prose before or after, no markdown fence. Keep every leaf ' +
      'description to ONE short line. A previous attempt was rejected as unparseable or truncated.';
    const invoke = deps.invoke ?? invokeNode;
    let spec: EpicSpec | undefined;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2 && !spec; attempt++) {
      const res = await invoke({
        prompt: attempt === 0 ? basePrompt : basePrompt + REPAIR_SUFFIX,
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
        lastErr = new Error(`the planner node failed or returned no text${res.rateLimited ? ' (rate-limited)' : ''}`);
        continue;
      }
      try { spec = parseEpicSpec(res.text); } catch (e) { lastErr = e; }
    }
    if (!spec) {
      throw new Error(`plan_mission_criterion: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    }

    // Second serve-integrity check before instantiation: a criterion may have been served by
    // another concurrent request during the (potentially long) planner node invocation.
    // Use a FRESH resolveActions read, not the stale actions from before the node invoke.
    assertServeIntegrity(project, input.missionId, input.criterionIds, resolveActions);

    // Instantiate: one epic homed to the mission, serving the criteria, with its leaves promoted to
    // READY (claimable by the daemon). Approve the epic (status:'ready' stamps approvedAt; the
    // servesCriterionIds edge satisfies the mission-homed approval guard).
    // Wrap in try/catch to ensure atomic-or-nothing: on any failure during instantiation,
    // drop the epic to clean up any partially-created leaves (cascading deletion).
    const { epic } = await createEpicWithLandLeaf(project, input.session, {
      title: spec.title,
      description: spec.description,
      home: input.missionId,
      homeProvided: true,
      servesCriterionIds: input.criterionIds,
    });
    try {
      const { createdIds } = await addLeavesToEpic(
        project,
        input.session,
        epic.id,
        spec.leaves.map((l) => ({ title: l.title, description: l.description, files: l.files, dependsOn: l.dependsOn, status: 'ready' as const })),
      );
      // Cross-project mission: serves inherit the mission NODE's targetProject so the
      // worker cwds + gates in the implementation repo, not the tracking repo. Without
      // this, a collab-homed mission targeting another repo gets serves stamped with
      // the tracking project and leaves execute against the wrong checkout (observed
      // 2026-07-23 twice on mission 6a6dd945 before the watcher rerouted by hand).
      const missionNode = listTodos(project, { includeCompleted: true }).find((t) => t.id === input.missionId);
      const inheritTarget = missionNode?.targetProject;
      if (inheritTarget && inheritTarget !== project) {
        await updateTodo(project, epic.id, { targetProject: inheritTarget });
        for (const leafId of createdIds) {
          await updateTodo(project, leafId, { targetProject: inheritTarget });
        }
      }
      await updateTodo(project, epic.id, { status: 'ready' }); // approve the epic for the daemon
      return { epicId: epic.id, epic, leafIds: createdIds, spec, modelUsed: model, effortUsed: effort };
    } catch (err) {
      // On any failure during instantiation, drop the epic. Dropping cascades to every
      // non-terminal descendant, cleaning up any partially-created leaves automatically.
      await updateTodo(project, epic.id, { status: 'dropped' });
      throw err;
    }
  })().finally(() => {
    // Clear reservation keys once the promise settles, allowing a later genuinely-new
    // serve for the same criteria to proceed.
    for (const key of keys) {
      inFlightServes.delete(key);
    }
  });

  // Store the promise under all keys before returning.
  for (const key of keys) {
    inFlightServes.set(key, promise);
  }

  return promise;
}
