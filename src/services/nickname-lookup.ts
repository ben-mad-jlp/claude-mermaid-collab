import { listTodos } from './todo-store.ts';
import { isMission } from './todo-kind.ts';
import { listCriteria } from './mission-store.ts';

export function nicknamesForProject(project: string): Record<string, string> {
  const out: Record<string, string> = {};
  const todos = listTodos(project, { includeCompleted: true });
  for (const t of todos) {
    if (t.nickname) out[t.id] = t.nickname;
  }
  const missionTodos = todos.filter((t) => isMission(t));
  for (const m of missionTodos) {
    const criteria = listCriteria(project, m.id);
    for (const c of criteria) {
      if (c.nickname) out[c.id] = c.nickname;
    }
  }
  return out;
}
