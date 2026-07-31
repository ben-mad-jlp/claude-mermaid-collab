import type { Todo } from './todo-store';

/** Serialize dispatch of ready leaves that declare the same file, so two workers
 *  never touch the same file concurrently within a single project's tick. Pure —
 *  no store/DB access; the caller supplies the pre-sorted ready set and owns the
 *  `heldFiles` set's lifetime (per-tick, seeded from in-flight leaves). */

/** Normalise a declared path so mixed-separator declarations from any OS compare
 *  equal: strip a leading `./`, then replace every `\` with `/`. */
export function normaliseDeclaredPath(p: string): string {
  const stripped = p.startsWith('./') ? p.slice(2) : p;
  return stripped.replace(/\\/g, '/');
}

export interface FileContentionPartition {
  dispatch: Todo[];
  deferred: Array<{ id: string; conflictFile: string }>;
}

/** Partition `ready` (already sorted by claim priority) into leaves that can
 *  dispatch this tick and leaves deferred by same-file contention. A todo with no
 *  `declaredFiles` is never deferred (no serialization for unlabelled legacy
 *  leaves). `heldFiles` is mutated in place — each dispatched todo's normalised
 *  paths are added so a later todo in the SAME call sees them as held. */
export function partitionByFileContention(ready: Todo[], heldFiles: Set<string>): FileContentionPartition {
  const dispatch: Todo[] = [];
  const deferred: Array<{ id: string; conflictFile: string }> = [];
  for (const todo of ready) {
    const declared = todo.declaredFiles ?? [];
    if (declared.length === 0) {
      dispatch.push(todo);
      continue;
    }
    const normalised = declared.map(normaliseDeclaredPath);
    const conflict = normalised.find((p) => heldFiles.has(p));
    if (conflict) {
      deferred.push({ id: todo.id, conflictFile: conflict });
      continue;
    }
    dispatch.push(todo);
    for (const p of normalised) heldFiles.add(p);
  }
  return { dispatch, deferred };
}
