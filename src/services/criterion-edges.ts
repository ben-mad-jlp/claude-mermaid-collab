export type CriterionEdged = {
  servesCriterionId?: string | null;
  servesCriterionIds?: string[] | null;
};

export function criterionEdgesOf(todo: CriterionEdged): string[] {
  // If servesCriterionIds is a non-empty array, filter and dedupe
  if (Array.isArray(todo.servesCriterionIds) && todo.servesCriterionIds.length > 0) {
    const filtered = todo.servesCriterionIds.filter(
      x => typeof x === 'string' && x.length > 0
    );
    // Dedupe while preserving first-seen order; dedup even though write path does,
    // because hand-built spec objects from workgraph-tools bypass normalizeCriterionEdges
    return [...new Set(filtered)];
  }

  // Empty-after-filter stays empty; don't fall through to singular.
  // If servesCriterionIds was [''], it emptied above and returns [] here.
  if (todo.servesCriterionId) {
    return [todo.servesCriterionId];
  }

  return [];
}

export function todoServesCriterion(
  todo: CriterionEdged,
  criterionId: string
): boolean {
  return criterionEdgesOf(todo).includes(criterionId);
}
