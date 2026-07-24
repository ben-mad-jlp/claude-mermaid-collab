/**
 * dep-settlement.ts — the ONE transactional primitive module for the dup-serve-stranding
 * class: `claimability.ts` `depSatisfied` requires a dep to be `done`/`accepted`, and
 * `depDropped` marks a dropped dep permanently unsatisfiable. A leaf held `manual` as a
 * duplicate of already-landed work strands its dependents forever — neither `done` nor
 * `dropped` — unless something settles it. This module is the shared settle/re-point
 * mechanism every future fix for that class calls, so no site invents its own half-fix.
 *
 * Scope: primitives only. Wiring a caller (claimability, coordinator, conductor) into
 * this module is a separate leaf.
 */
import { getTodo, listTodos, completeTodo, openDb, type Todo } from './todo-store';
import { resolveDepId } from './claimability';
import { fireOrchestratorKick } from './orchestrator-kick';
import { recordAutonomousMutation } from './autonomy-log';

/**
 * Shared vocabulary token. It is BOTH a legal `heldReason` value (joining `'manual'` /
 * `'migrated-park'`) and the prefix of the `completedBy` provenance handle
 * `settleDupOfLanded` stamps — there is no schema change, the string IS the contract.
 */
export const DUP_OF_LANDED = 'dup-of-landed';

/**
 * Every non-terminal todo whose `dependsOn` has an entry that resolves (via the SAME
 * `resolveDepId` short-id logic `depSatisfied`/`claimReason` use) to `todoId`. Reusing
 * `resolveDepId` is mandatory: a hand-rolled prefix match here could diverge from what
 * claimability actually treats as an edge and silently miss (or over-match) dependents.
 */
export function dependentsOf(project: string, todoId: string): Todo[] {
  const byId = new Map<string, Todo>();
  for (const t of listTodos(project, { includeCompleted: true })) byId.set(t.id, t);
  const target = resolveDepId(todoId, byId);
  const targetFullId = target ? target.id : todoId;
  const out: Todo[] = [];
  for (const t of byId.values()) {
    if (t.status === 'done' || t.status === 'dropped') continue;
    for (const dep of t.dependsOn ?? []) {
      if (resolveDepId(dep, byId)?.id === targetFullId) {
        out.push(t);
        break;
      }
    }
  }
  return out;
}

/**
 * Settle a leaf that is a duplicate of already-landed work: mark it done+accepted with a
 * `dup-of-landed:<sha8>[:<todoId8>]` provenance handle, via `completeTodo` — which already
 * clears `heldAt`/`heldReason` and fires the `dep-terminal` kick that wakes every dependent
 * on the next `isClaimable` derive. Idempotent: a todo already settled by THIS mechanism
 * (its `completedBy` starts with `DUP_OF_LANDED + ':'`) is a no-op.
 */
export async function settleDupOfLanded(
  project: string,
  todoId: string,
  opts: { landedCommit: string; landedTodoId?: string; actor: string; reason: string },
): Promise<{ settled: boolean; todoId: string | null }> {
  const existing = getTodo(project, todoId);
  if (!existing) throw new Error(`todo not found: ${todoId}`);
  const handle =
    `${DUP_OF_LANDED}:${opts.landedCommit.slice(0, 8)}` +
    (opts.landedTodoId ? `:${opts.landedTodoId.slice(0, 8)}` : '');

  if (
    existing.status === 'done' &&
    existing.acceptanceStatus === 'accepted' &&
    typeof existing.completedBy === 'string' &&
    existing.completedBy.startsWith(`${DUP_OF_LANDED}:`)
  ) {
    return { settled: false, todoId: null };
  }

  const { completed } = await completeTodo(project, todoId, 'accepted', handle);

  recordAutonomousMutation({
    kind: 'dep-settlement',
    actor: opts.actor,
    reason: opts.reason,
    project,
    detail: `${existing.id.slice(0, 8)}@${opts.landedCommit.slice(0, 8)}`,
  });

  return { settled: true, todoId: completed.id };
}

/**
 * Re-point every dependent's `dependsOn` edge from `fromId` to `toId` (or drop the edge
 * entirely when `toId` is null), in ONE transaction — writing `dependsOn` via raw SQL
 * rather than N `updateTodo` calls so the whole rewrite is atomic and fires exactly one
 * kick. Idempotent: if no dependent's `dependsOn` currently resolves to `fromId`, the
 * transaction runs zero UPDATEs and no kick fires (a re-run finds edges already pointing
 * at `toId`, so nothing resolves to `fromId` anymore).
 */
export function repointDependents(
  project: string,
  fromId: string,
  toId: string | null,
  opts: { actor: string; reason: string },
): { affected: string[] } {
  const byId = new Map<string, Todo>();
  for (const t of listTodos(project, { includeCompleted: true })) byId.set(t.id, t);
  const fromTodo = resolveDepId(fromId, byId);
  const fromFullId = fromTodo ? fromTodo.id : fromId;

  const affected: string[] = [];
  const db = openDb(project);
  const now = new Date().toISOString();

  db.transaction(() => {
    for (const t of byId.values()) {
      if (t.status === 'done' || t.status === 'dropped') continue;
      const deps = t.dependsOn ?? [];
      let touched = false;
      const nextDeps: string[] = [];
      for (const dep of deps) {
        if (resolveDepId(dep, byId)?.id === fromFullId) {
          touched = true;
          if (toId !== null) nextDeps.push(toId);
        } else {
          nextDeps.push(dep);
        }
      }
      if (!touched) continue;
      const deduped = [...new Set(nextDeps)];
      db.prepare('UPDATE todos SET dependsOn = ?, updatedAt = ? WHERE id = ?').run(
        JSON.stringify(deduped),
        now,
        t.id,
      );
      affected.push(t.id);
    }
  })();

  if (affected.length > 0) {
    fireOrchestratorKick(`dep-repoint:${fromFullId.slice(0, 8)}`);
    recordAutonomousMutation({
      kind: 'dep-settlement',
      actor: opts.actor,
      reason: opts.reason,
      project,
      detail: `${fromFullId.slice(0, 8)}→${toId ? toId.slice(0, 8) : 'drop'} x${affected.length}`,
    });
  }

  return { affected };
}
