import type { DecisionRecord } from './decision-record-store';

/**
 * Planning reconciliation harness (PCS spike, open-problem #4 / consult 3).
 *
 * When two planning threads edit the work-graph in parallel, merge their
 * changes against the active constraints. This is the SKELETON: deterministic
 * pre-checks short-circuit the easy cases; the hard semantic merge is delegated
 * to an injected `llmMerge` (in production a SPAWNED tmux Claude session —
 * subscription auth, NO API key — handed the inputs and writing the merged
 * graph back; here it's a dependency so the harness is unit-testable); then
 * deterministic post-checks validate the result. The OPEN question this exists
 * to answer (run it on ~5 real concurrent workflows) is whether the llmMerge
 * output is usable without heavy human editing — that's the human step, not code.
 */

export interface PlanNode {
  id: string;
  dependsOn: string[];
  parentId?: string | null;
  title?: string;
}

export interface ReconcileInputs {
  /** Common ancestor graph (optional; informs the merge but not required). */
  base?: PlanNode[];
  /** Thread A's version of the changed nodes. */
  deltaA: PlanNode[];
  /** Thread B's version of the changed nodes. */
  deltaB: PlanNode[];
  /** Active constraints in scope (from decision-record-store.getActiveConstraints). */
  constraints: DecisionRecord[];
}

export type ReconcileMethod = 'orthogonal-union' | 'llm-merge';

export interface ReconcileResult {
  mergedGraph: PlanNode[];
  newConstraints: Array<{ title: string; rationale?: string }>;
  method: ReconcileMethod;
  valid: boolean;
  /** Post-check problems (cycles, dangling refs, constraint violations). Empty when valid. */
  issues: string[];
}

export interface ReconcileDeps {
  /** The semantic merge. Production impl spawns a Claude session; tests inject a stub. */
  llmMerge: (inputs: ReconcileInputs) => Promise<{ mergedGraph: PlanNode[]; newConstraints?: Array<{ title: string; rationale?: string }> }>;
}

// --- Deterministic checks (pure) ---

const idsOf = (nodes: PlanNode[]): Set<string> => new Set(nodes.map((n) => n.id));

/** Two deltas are orthogonal when they touch disjoint node-id sets AND neither
 *  introduces a dependency onto a node the other changed (no cross-reference). */
export function areOrthogonal(deltaA: PlanNode[], deltaB: PlanNode[]): boolean {
  const a = idsOf(deltaA);
  const b = idsOf(deltaB);
  for (const id of a) if (b.has(id)) return false; // same node edited on both sides
  const refsCross = (nodes: PlanNode[], other: Set<string>) =>
    nodes.some((n) => (n.dependsOn ?? []).some((d) => other.has(d)) || (n.parentId != null && other.has(n.parentId)));
  if (refsCross(deltaA, b) || refsCross(deltaB, a)) return false;
  return true;
}

/** First cycle found (list of node ids) or null. Generic over PlanNode.dependsOn. */
export function findCycle(nodes: PlanNode[]): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  function dfs(id: string): string[] | null {
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    if (visited.has(id)) return null;
    visiting.add(id); stack.push(id);
    for (const d of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(d)) { const c = dfs(d); if (c) return c; }
    }
    visiting.delete(id); stack.pop(); visited.add(id);
    return null;
  }
  for (const n of nodes) { const c = dfs(n.id); if (c) return c; }
  return null;
}

/** dependsOn / parentId ids that point at nodes not present in the graph. */
export function danglingRefs(nodes: PlanNode[]): string[] {
  const ids = idsOf(nodes);
  const bad = new Set<string>();
  for (const n of nodes) {
    for (const d of n.dependsOn ?? []) if (!ids.has(d)) bad.add(d);
    if (n.parentId != null && !ids.has(n.parentId)) bad.add(n.parentId);
  }
  return [...bad];
}

/** Post-check a merged graph: cycles, dangling refs, dropped constraint-linked todos. */
export function validateMerged(merged: PlanNode[], constraints: DecisionRecord[]): string[] {
  const issues: string[] = [];
  const cycle = findCycle(merged);
  if (cycle) issues.push(`cycle: ${cycle.join(' → ')}`);
  const dangling = danglingRefs(merged);
  if (dangling.length) issues.push(`dangling refs: ${dangling.join(', ')}`);
  // A merge must not silently drop a todo an active constraint depends on.
  const ids = idsOf(merged);
  for (const c of constraints) {
    if (c.status !== 'active') continue;
    const dropped = (c.linkedTodos ?? []).filter((t) => !ids.has(t));
    if (dropped.length) issues.push(`constraint "${c.title}" lost linked todo(s): ${dropped.join(', ')}`);
  }
  return issues;
}

function unionById(a: PlanNode[], b: PlanNode[]): PlanNode[] {
  const m = new Map<string, PlanNode>();
  for (const n of [...a, ...b]) m.set(n.id, n);
  return [...m.values()];
}

/**
 * Orchestrate one reconciliation. Orthogonal deltas short-circuit to a
 * deterministic union (no LLM). Otherwise the injected llmMerge does the
 * semantic merge, and the result is validated by deterministic post-checks.
 */
export async function runReconcile(deps: ReconcileDeps, inputs: ReconcileInputs): Promise<ReconcileResult> {
  if (areOrthogonal(inputs.deltaA, inputs.deltaB)) {
    const mergedGraph = unionById(inputs.deltaA, inputs.deltaB);
    const issues = validateMerged(mergedGraph, inputs.constraints);
    return { mergedGraph, newConstraints: [], method: 'orthogonal-union', valid: issues.length === 0, issues };
  }
  const out = await deps.llmMerge(inputs);
  const mergedGraph = out.mergedGraph ?? [];
  const issues = validateMerged(mergedGraph, inputs.constraints);
  return { mergedGraph, newConstraints: out.newConstraints ?? [], method: 'llm-merge', valid: issues.length === 0, issues };
}
