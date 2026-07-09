/**
 * SR-6: Split decision types and validation. Shared between leaf-executor and todo-store
 * (which have a circular import risk, so split-decision is a leaf module).
 */

/** SR-6: one independent unit of a blueprint-authored split. An item MAY hold more than
 *  one file — per-FILE is not sacred, per-INDEPENDENT-UNIT is. */
export interface LeafSplitItem {
  id: string;              // unique within the decision; referenced by siblings' dependsOn
  files: string[];         // >= 1 file; this item becomes exactly ONE child leaf
  dependsOn: string[];     // sibling item ids that MUST land first
  description?: string;    // optional one-liner, used in the child's description
}

/** SR-6: the split decision the BLUEPRINT emits. `split:false` means COUPLED — the leaf
 *  runs whole no matter how many files it touches, and `reason` states the cross-file
 *  invariant (a lock protocol, a shared timeout primitive, a two-sided predicate). */
export interface LeafSplitDecision {
  split: boolean;
  reason: string;
  items: LeafSplitItem[];  // [] when split === false
}

/** Validate a raw `splitDecision`. Returns the decision, or null if the key is present but
 *  malformed. Callers treat null-with-key-present as "take the floor". Never throws. */
export function parseSplitDecision(raw: unknown): LeafSplitDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.split !== 'boolean') return null;
  if (typeof d.reason !== 'string' || !d.reason.trim()) return null;
  const itemsRaw = Array.isArray(d.items) ? d.items : [];

  if (!d.split) return { split: false, reason: d.reason, items: [] }; // items ignored

  // split:true ⇒ items must be a real, acyclic, self-consistent DAG of >= 2 units.
  const items: LeafSplitItem[] = [];
  for (const it of itemsRaw) {
    if (!it || typeof it !== 'object') return null;
    const o = it as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id.trim()) return null;
    const files = Array.isArray(o.files) ? o.files.filter((f): f is string => typeof f === 'string' && !!f.trim()) : [];
    if (files.length === 0) return null;                       // an item with no files is meaningless
    const dependsOn = Array.isArray(o.dependsOn) ? o.dependsOn : [];
    if (!dependsOn.every((x) => typeof x === 'string')) return null;
    items.push({
      id: o.id.trim(),
      files: files.map((f) => f.trim()),
      dependsOn: (dependsOn as string[]).map((x) => x.trim()),
      ...(typeof o.description === 'string' ? { description: o.description } : {}),
    });
  }
  if (items.length < 2) return null;                            // a 1-item "split" is not a split
  const ids = new Set(items.map((i) => i.id));
  if (ids.size !== items.length) return null;                   // duplicate ids
  for (const i of items) {
    if (i.dependsOn.some((dep) => dep === i.id || !ids.has(dep))) return null; // self / dangling
  }
  if (hasCycle(items)) return null;
  return { split: true, reason: d.reason, items };
}

/** Kahn's algorithm, cycle iff not all nodes drain. */
export function hasCycle(items: LeafSplitItem[]): boolean {
  const indeg = new Map(items.map((i) => [i.id, i.dependsOn.length]));
  const dependents = new Map<string, string[]>();
  for (const i of items) for (const d of i.dependsOn) {
    dependents.set(d, [...(dependents.get(d) ?? []), i.id]);
  }
  const queue = items.filter((i) => i.dependsOn.length === 0).map((i) => i.id);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift()!;
    seen += 1;
    for (const dep of dependents.get(id) ?? []) {
      const n = (indeg.get(dep) ?? 0) - 1;
      indeg.set(dep, n);
      if (n === 0) queue.push(dep);
    }
  }
  return seen !== items.length;
}

/** Topologically sort split items using Kahn's algorithm. Throws on a cycle — callers
 *  validate first (parseSplitDecision rejects cycles), so reaching this throw means a
 *  caller bypassed validation. */
export function topoSortSplitItems(items: LeafSplitItem[]): LeafSplitItem[] {
  if (items.length === 0) return [];
  const indeg = new Map(items.map((i) => [i.id, i.dependsOn.length]));
  const idToItem = new Map(items.map((i) => [i.id, i]));
  const dependents = new Map<string, string[]>();
  for (const i of items) for (const d of i.dependsOn) {
    dependents.set(d, [...(dependents.get(d) ?? []), i.id]);
  }
  const queue = items.filter((i) => i.dependsOn.length === 0).map((i) => i.id);
  const sorted: LeafSplitItem[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const item = idToItem.get(id);
    if (item) sorted.push(item);
    for (const dep of dependents.get(id) ?? []) {
      const n = (indeg.get(dep) ?? 0) - 1;
      indeg.set(dep, n);
      if (n === 0) queue.push(dep);
    }
  }
  if (sorted.length !== items.length) throw new Error('topoSortSplitItems: cycle detected');
  return sorted;
}
