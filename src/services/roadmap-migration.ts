import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listItems, listItemTodos } from './roadmap-store';
import { getTodo, importTodo, updateTodo, type TodoStatus } from './todo-store';

export const ROADMAP_OWNER = '__roadmap__';
const MIGRATION_SENTINEL_ID = '__roadmap_migration_v1__';
const ROADMAP_STATUS_MAP: Record<string, TodoStatus> = {
  planned: 'planned',
  ready: 'ready',
  in_progress: 'in_progress',
  blocked: 'blocked',
  done: 'done',
  dropped: 'dropped',
};

export async function migrateRoadmapToTodos(
  project: string
): Promise<{ migrated: number; skipped: boolean }> {
  const roadmapPath = join(project, '.collab', 'roadmap.db');
  if (!existsSync(roadmapPath)) return { migrated: 0, skipped: true };
  if (getTodo(project, MIGRATION_SENTINEL_ID) !== null) return { migrated: 0, skipped: true };

  const items = listItems(project);
  let migrated = 0;

  for (const item of items) {
    const status: TodoStatus = ROADMAP_STATUS_MAP[item.status] ?? 'planned';
    importTodo(project, {
      id: item.id,
      ownerSession: ROADMAP_OWNER,
      title: item.title,
      description: item.description,
      status,
      parentId: item.parentId,
      dependsOn: item.dependsOn,
      order: item.ord,
      sessionName: item.sessionName,
      blueprintId: item.blueprintId,
    });
    migrated++;
  }

  for (const item of items) {
    const linkedTodoIds = listItemTodos(project, item.id);
    for (const todoId of linkedTodoIds) {
      const linked = getTodo(project, todoId);
      if (linked && linked.parentId === null) await updateTodo(project, todoId, { parentId: item.id });
    }
  }

  importTodo(project, {
    id: MIGRATION_SENTINEL_ID,
    ownerSession: ROADMAP_OWNER,
    title: MIGRATION_SENTINEL_ID,
    status: 'done',
  });

  return { migrated, skipped: false };
}
