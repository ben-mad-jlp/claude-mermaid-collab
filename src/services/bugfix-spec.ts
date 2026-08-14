/** Typed spec for a `bugfix` bucket leaf: the observed failure, evidence path, and fixed means. */
export interface BugfixSpec {
  observedFailure: string;
  evidence: string;
  fixedMeans: string;
}

/**
 * Read a BugfixSpec from a todo, resolving in order:
 * 1. Stored `todo.bugfixSpec` with all three non-empty strings → return it verbatim
 * 2. Parse legacy `todo.description` for Failure:/Evidence:/Fixed: labels
 * 3. Return null if neither path yields a valid spec
 */
export function readBugfixSpec(todo: {
  bugfixSpec?: BugfixSpec | null;
  description?: string | null;
}): BugfixSpec | null {
  // Path 1: stored spec
  if (
    todo.bugfixSpec &&
    todo.bugfixSpec.observedFailure?.trim() &&
    todo.bugfixSpec.evidence?.trim() &&
    todo.bugfixSpec.fixedMeans?.trim()
  ) {
    return todo.bugfixSpec;
  }

  // Path 2: legacy prose block
  if (!todo.description || !todo.description.includes('Failure:')) {
    return null;
  }

  const desc = todo.description;
  const failureMatch = desc.match(/^Failure:\s*([\s\S]*?)(?=Evidence:|$)/im);
  const evidenceMatch = desc.match(/^Evidence:\s*([\s\S]*?)(?=Fixed:|$)/im);
  const fixedMatch = desc.match(/^Fixed:\s*([\s\S]*?)$/im);

  const observedFailure = failureMatch?.[1]?.trim();
  const evidence = evidenceMatch?.[1]?.trim();
  const fixedMeans = fixedMatch?.[1]?.trim();

  if (observedFailure && evidence && fixedMeans) {
    return { observedFailure, evidence, fixedMeans };
  }

  return null;
}
