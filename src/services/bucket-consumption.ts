/**
 * bucket-consumption.ts — tracking bucket item consumption by epics and missions.
 *
 * When a bucket item (a leaf todo descended from a bucket epic) is promoted to a
 * real epic, it is marked `status=done` with `promotedTo=<epicId>` and
 * `consumedAt=<iso-timestamp>`. The ONE writer of consumption state is `consumeBucketItems`.
 * Callers gate reopening (restoring consumed items to 'planned') on `!consumerDelivered`,
 * which checks if the consumer (epic or mission) has landed/closed.
 *
 * This module imports `isBucketEpic` from bucket-registry (the SINGLE canonical predicate
 * for "is this a bucket?") and does NOT redefine it.
 */

import { isBucketEpic, type BucketBearing } from './bucket-registry.ts';
import { openDb, getTodo, listTodos, updateTodo } from './todo-store.ts';
import { getMission } from './mission-store.ts';
import { isEpic } from './todo-kind.ts';
import { hasLandStamp } from './epic-landedness.ts';

/** Check if a todo (by id) is a bucket item: a non-container descendant of a bucket epic.
 *
 * Walks the parentId chain upward (guards against cycles), returning true the FIRST time
 * an ancestor satisfies isBucketEpic. The starting todo itself is NOT tested against
 * isBucketEpic (a bucket epic is not "a bucket item" of itself); only ancestors are tested.
 * Returns false if no ancestor chain reaches a bucket epic, or if the todo is not found. */
export function isBucketItem(project: string, todoId: string): boolean {
  const todo = getTodo(project, todoId);
  if (!todo) return false;

  const visited = new Set<string>();
  let current = todo;

  while (current.parentId) {
    if (visited.has(current.parentId)) break; // Cycle guard
    visited.add(current.parentId);

    const parent = getTodo(project, current.parentId);
    if (!parent) break;

    if (isBucketEpic(parent)) return true;
    current = parent;
  }

  return false;
}

/** Consume bucket items: mark them done and promoted to a consumer (epic or mission).
 *
 * Iterates the supplied itemIds only (never derives a broader set). For each id:
 * - Not found → skip reason 'not-found'
 * - Not a bucket item → skip reason 'not-a-bucket-item'
 * - Already terminal (status='done'|'dropped') → skip reason 'already-terminal'
 * - Otherwise → await updateTodo with status='done', promotedTo=consumer.id,
 *   consumedAt=now (ISO), and push the id to the consumed array.
 *
 * consumer.kind is accepted for call-site clarity and future branching but is not
 * consulted by this function today (both mission and epic consumers write the same shape). */
export async function consumeBucketItems(
  project: string,
  itemIds: string[],
  consumer: { id: string; kind: 'mission' | 'epic' }
): Promise<{
  consumed: string[];
  skipped: Array<{ id: string; reason: 'not-a-bucket-item' | 'already-terminal' | 'not-found' }>;
}> {
  const consumed: string[] = [];
  const skipped: Array<{ id: string; reason: 'not-a-bucket-item' | 'already-terminal' | 'not-found' }> = [];

  for (const id of itemIds) {
    const todo = getTodo(project, id);
    if (!todo) {
      skipped.push({ id, reason: 'not-found' });
      continue;
    }

    if (!isBucketItem(project, id)) {
      skipped.push({ id, reason: 'not-a-bucket-item' });
      continue;
    }

    if (todo.status === 'done' || todo.status === 'dropped') {
      skipped.push({ id, reason: 'already-terminal' });
      continue;
    }

    await updateTodo(project, id, {
      status: 'done',
      promotedTo: consumer.id,
      consumedAt: new Date().toISOString(),
    });
    consumed.push(id);
  }

  return { consumed, skipped };
}

/** Reopen consumed items for a consumer: restore status to 'planned' and clear consumption state.
 *
 * SYNCHRONOUS raw-SQL function (callable from deleteMission, mirroring bucket-registry's
 * direct db.prepare writes). Queries for todos with promotedTo=consumerId and consumedAt!=null,
 * restores them to status='planned' with promotedTo=null and consumedAt=null, and returns
 * the array of reopened ids. Does NOT route through updateTodo (must stay sync). */
export function reopenConsumedFor(project: string, consumerId: string): string[] {
  const db = openDb(project);
  const nowIso = new Date().toISOString();

  const rows = db
    .prepare('SELECT id FROM todos WHERE promotedTo = ? AND consumedAt IS NOT NULL AND status = ?')
    .all(consumerId, 'done') as Array<{ id: string }>;

  const reopened: string[] = [];
  for (const row of rows) {
    db.prepare('UPDATE todos SET status=?, promotedTo=NULL, consumedAt=NULL, updatedAt=? WHERE id=?').run(
      'planned',
      nowIso,
      row.id
    );
    reopened.push(row.id);
  }

  return reopened;
}

/** Check if a consumer (epic or mission) is delivered and its bucket items should stay terminal.
 *
 * An epic consumer is delivered when it carries the land-intent stamp — asked through the
 * canonical producer `hasLandStamp` (epic-landedness.ts), never by re-deriving the field here.
 * A mission consumer is delivered when its mission row's `closedAt` is non-null OR its
 * derived status is 'converged'.
 * A delivered consumer's bucket items stay terminal — an undelivered one's are reopened
 * by reopenConsumedFor, which callers must gate on !consumerDelivered(...).
 *
 * Returns false if neither a matching epic todo nor mission row is found (undelivered —
 * fail toward reopening, never toward silently leaving items stranded consumed). */
export function consumerDelivered(project: string, consumerId: string): boolean {
  const epicTodo = getTodo(project, consumerId);
  if (epicTodo && isEpic(epicTodo)) {
    return hasLandStamp(epicTodo);
  }

  const mission = getMission(project, consumerId);
  if (mission) {
    return mission.closedAt != null || mission.status === 'converged';
  }

  return false;
}
