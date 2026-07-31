/**
 * Pure file-contention primitives.
 *
 * EMPTY-SET RULE: a leaf with an empty/absent declared-files set is UNCONSTRAINED — it is
 * never deferred, and it contributes nothing to the held-files set. The declaredFiles/
 * inheritedFiles column is new and most existing rows are `[]`; treating empty as
 * "conflicts with everything" would serialize the whole fleet and regress throughput.
 *
 * This module is intentionally standalone (zero project-local imports) even though its
 * normalization logic rhymes with the private normalizePaths in leaf-commit-scope.ts.
 */

export function normalizeDeclaredFiles(paths: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of paths) {
    let p = raw.trim();
    if (p.startsWith('./')) p = p.slice(2);
    if (p.length === 0) continue;
    seen.add(p);
  }
  return Array.from(seen);
}

export function declaredFilesConflict(a: string[], b: string[]): boolean {
  const normA = normalizeDeclaredFiles(a);
  const normB = normalizeDeclaredFiles(b);
  const setA = new Set(normA);
  return normB.some((f) => setA.has(f));
}

export function partitionByContention<T>(
  candidates: T[],
  heldFiles: Set<string>,
  filesOf: (t: T) => string[]
): { dispatch: T[]; deferred: T[] } {
  const dispatch: T[] = [];
  const deferred: T[] = [];

  for (const c of candidates) {
    const files = normalizeDeclaredFiles(filesOf(c));

    if (files.length === 0) {
      dispatch.push(c);
      continue;
    }

    const conflicts = files.some((f) => heldFiles.has(f));
    if (conflicts) {
      deferred.push(c);
    } else {
      dispatch.push(c);
      for (const f of files) heldFiles.add(f);
    }
  }

  return { dispatch, deferred };
}
