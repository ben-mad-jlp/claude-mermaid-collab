import type { Todo, TodoStatus, UpdateTodoPatch } from './todo-store';
import { updateTodo } from './todo-store';

/** A snapshot row capturing a single todo's status and decision fields. */
export interface EpicSubtreeSnapshotRow {
  id: string;
  status: TodoStatus;
  heldAt: string | null;
  heldReason: string | null;
  acceptanceStatus: Todo['acceptanceStatus'];
}

/** A complete snapshot of an epic and all its non-terminal descendants. */
export interface EpicSubtreeSnapshot {
  epicId: string;
  rows: EpicSubtreeSnapshotRow[];
}

/**
 * Build a snapshot of an epic subtree from an already-fetched Todo[].
 * Pure, synchronous, no I/O. Captures the epic itself (unconditionally as rows[0])
 * and all transitive descendants whose status is not 'done' or 'dropped'.
 * Terminal descendants are not captured — they were not touched by the cascade.
 */
export function snapshotEpicSubtree(todos: Todo[], epicId: string): EpicSubtreeSnapshot {
  // Build a parentId → children map for fast tree traversal.
  const childrenOf = new Map<string | null, Todo[]>();
  for (const todo of todos) {
    const parent = todo.parentId ?? null;
    if (!childrenOf.has(parent)) {
      childrenOf.set(parent, []);
    }
    childrenOf.get(parent)!.push(todo);
  }

  const rows: EpicSubtreeSnapshotRow[] = [];

  // Find the epic itself.
  const epic = todos.find((t) => t.id === epicId);
  if (!epic) {
    // Epic not found in the list; still return a valid snapshot with just the epicId.
    return { epicId, rows: [] };
  }

  // Epic is always row[0], regardless of its own status.
  rows.push({
    id: epic.id,
    status: epic.status,
    heldAt: epic.heldAt ?? null,
    heldReason: epic.heldReason ?? null,
    acceptanceStatus: epic.acceptanceStatus ?? null,
  });

  // Traverse descendants in BFS order. Capture non-terminal ones.
  const queue: string[] = [epicId];
  const seen = new Set<string>([epicId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenOf.get(current) ?? [];

    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);

      // Capture non-terminal descendants.
      if (child.status !== 'done' && child.status !== 'dropped') {
        rows.push({
          id: child.id,
          status: child.status,
          heldAt: child.heldAt ?? null,
          heldReason: child.heldReason ?? null,
          acceptanceStatus: child.acceptanceStatus ?? null,
        });
      }

      queue.push(child.id);
    }
  }

  return { epicId, rows };
}

/**
 * Translate a stored status to a derived status for restoration.
 * Derived statuses ('ready', 'blocked', 'in_progress') map to 'ready'.
 * Stored statuses ('planned', 'backlog', 'todo', 'done', 'dropped') pass through.
 */
function statusForRestore(status: TodoStatus): TodoStatus {
  switch (status) {
    case 'ready':
    case 'blocked':
    case 'in_progress':
      return 'ready';
    case 'planned':
    case 'backlog':
    case 'todo':
    case 'done':
    case 'dropped':
      return status;
    default:
      const _exhaustive: never = status;
      return _exhaustive;
  }
}

/**
 * Restore an epic subtree from a snapshot via two separate updateTodo patches per row:
 * 1. Status-only patch (so derived-status translation applies)
 * 2. Decision patch with heldAt/heldReason/acceptanceStatus (separate call so no translation)
 *
 * Never throws — each row wrapped in try/catch. Returns lists of restored and failed ids.
 * Default updateTodoFn is updateTodo from todo-store; tests may inject a mock.
 */
export async function restoreEpicSubtree(
  project: string,
  snap: EpicSubtreeSnapshot,
  updateTodoFn: typeof updateTodo = updateTodo,
): Promise<{ restored: string[]; failed: string[] }> {
  const restored: string[] = [];
  const failed: string[] = [];

  // Restore in order: epic first (snap.rows[0]), then descendants.
  for (const row of snap.rows) {
    try {
      // Patch 1: Status only.
      const statusPatch: UpdateTodoPatch = { status: statusForRestore(row.status) };
      await updateTodoFn(project, row.id, statusPatch);

      // Patch 2: Decision fields only (no status).
      const decisionPatch: UpdateTodoPatch = {
        heldAt: row.heldAt,
        heldReason: row.heldReason,
        acceptanceStatus: row.acceptanceStatus,
      };
      await updateTodoFn(project, row.id, decisionPatch);

      restored.push(row.id);
    } catch (err) {
      // Best-effort: record failure and continue.
      failed.push(row.id);
    }
  }

  return { restored, failed };
}
