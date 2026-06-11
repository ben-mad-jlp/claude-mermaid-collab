import { listItems, listItemTodos, type RoadmapItem, type RoadmapStatus } from './roadmap-store';

/**
 * roadmap_rollup — roadmap items joined to their spawned sessions (read-only).
 *
 * `roadmap_list` returns the bare items; it does NOT show the session each item
 * was spawned into (`roadmap_spawn_session` sets `sessionName` + links the
 * created todos). This tool rolls each item up with its session binding and the
 * ids of the todos linked to it, so the steward can see at a glance which roadmap
 * items have a live session and which are still un-spawned.
 *
 * The core (`summarizeRoadmap`) is a PURE function over already-fetched inputs so
 * it is trivially unit-testable; `roadmapRollup` is the thin store-backed wrapper
 * the MCP tool calls.
 */

export interface RoadmapRollupItem {
  id: string;
  title: string;
  status: RoadmapStatus;
  parentId: string | null;
  /** The collab session this item was spawned into, or null if un-spawned. */
  sessionName: string | null;
  /** Ids of the work-graph todos linked to this item. */
  todoIds: string[];
  todoCount: number;
}

export interface RoadmapRollup {
  total: number;
  /** Count of items that have been spawned into a session. */
  spawned: number;
  /** Count of items with no session binding yet. */
  unspawned: number;
  items: RoadmapRollupItem[];
}

/** Pure rollup: join each item to its linked-todo ids. `todosByItem` maps an
 *  item id → its linked todo ids (as listItemTodos returns). */
export function summarizeRoadmap(
  items: RoadmapItem[],
  todosByItem: Map<string, string[]>,
): RoadmapRollup {
  const rolled: RoadmapRollupItem[] = items.map((it) => {
    const todoIds = todosByItem.get(it.id) ?? [];
    return {
      id: it.id,
      title: it.title,
      status: it.status,
      parentId: it.parentId,
      sessionName: it.sessionName,
      todoIds,
      todoCount: todoIds.length,
    };
  });
  const spawned = rolled.filter((r) => r.sessionName).length;
  return {
    total: rolled.length,
    spawned,
    unspawned: rolled.length - spawned,
    items: rolled,
  };
}

/** Store-backed wrapper: list the project's roadmap items and their linked todos. */
export function roadmapRollup(project: string): RoadmapRollup {
  const items = listItems(project);
  const todosByItem = new Map<string, string[]>();
  for (const it of items) todosByItem.set(it.id, listItemTodos(project, it.id));
  return summarizeRoadmap(items, todosByItem);
}
