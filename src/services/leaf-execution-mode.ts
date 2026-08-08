/**
 * leaf-execution-mode — which EXECUTION SHAPE a leaf runs, and the node kinds that shape uses.
 *
 * Extracted from leaf-executor.ts: this is a pure DISPATCH TABLE, not executor logic, and
 * leaf-executor is under a strict LOC ratchet (current <= base) precisely to push code like
 * this into modules. Re-exported from leaf-executor so existing importers are unaffected.
 */
import type { Todo } from './todo-store.js';
import type { LeafNodeKind } from './leaf-executor.js';

/** Which EXECUTION SHAPE a leaf runs (epic f5c7fc46). 'code' (default) is the proven
 *  blueprint→implement/waves→tsc-review AUTHORING pipeline; 'verify' is the non-code
 *  dogfood pipeline (plan → deterministic driver verb → domain gate → committed report);
 *  'review' (epic d8ac1a18 dogfood) is a completeness review over an epic's union change-set
 *  (one LLM judgment node → committed report → file gap todos); 'explore' is a read-only
 *  investigation that emits a findings report. Code/verify/review are AUTHORING or
 *  NON-AUTHORING shapes whose deliverable is a COMMITTED report (so they survive the
 *  completion gate's work-committed re-verify, exactly like the code path's commit).
 *  Keyed off the leaf's `type`: 'verify'/'cad-dogfood'/'dogfood' → verify; 'reviewer' →
 *  review; 'explore' → explore; else code. THIN dispatch, deliberately NOT a recipe registry
 *  (YAGNI — only a few real shapes; see the recipe-space analysis in doc
 *  executor-recipe-registry-design). Pure. */
export function leafExecutionMode(leaf: Todo): 'code' | 'verify' | 'review' | 'explore' {
  const t = (leaf.type ?? '').toLowerCase();
  if (t === 'verify' || t === 'cad-dogfood' || t === 'dogfood') return 'verify';
  if (t === 'reviewer') return 'review';
  if (t === 'explore') return 'explore';
  return 'code';
}

/** The node kinds a leaf's run will actually execute, keyed off leafExecutionMode. Drives the
 *  kind-scoped grok/xai auth pre-flight (bug 3764675c) so a dead-kind override can't gate a
 *  floor leaf. Pure. */
export function leafRunKinds(leaf: Todo): LeafNodeKind[] {
  switch (leafExecutionMode(leaf)) {
    case 'verify': return ['driveplan', 'driveexec', 'report'];
    case 'review': return ['review'];
    case 'explore': return ['explore', 'report'];
    default: return ['blueprint', 'implement', 'review']; // floor
  }
}

/** True iff the given leaf is an explore-typed leaf and another explore-typed leaf is
 *  currently in-flight (claimed). Returns false immediately if this leaf is not an explore
 *  leaf, so non-explore leaves pay no cost on the hot claim path. Pure. */
export function exploreInflightBlocked(leaf: Todo, others: Iterable<Todo>): boolean {
  if (leafExecutionMode(leaf) !== 'explore') return false;
  for (const o of others) {
    if (o.id === leaf.id) continue;
    if (o.claim != null && leafExecutionMode(o) === 'explore') return true;
  }
  return false;
}
