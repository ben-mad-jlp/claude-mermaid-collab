import { listTodos, updateTodo, type Todo } from './todo-store';

interface QuarantineDedupDeps {
  listTodos?: typeof listTodos;
  updateTodo?: typeof updateTodo;
}

const QUARANTINE_TITLE_PREFIX = '[BUG] flaky test quarantined: ';

/**
 * Derive a stable dedup key from a (possibly vitest-progress-counter-prefixed) test
 * string. Rows that name the same `src/...` file collapse to one key regardless of
 * the leading `(n/m)` counter; rows with no `src/` token key off their own full text
 * so distinct name-only titles never collapse.
 */
export function quarantineDedupKey(test: string): string {
  const stripped = test.replace(/^\(\d+\/\d+\)\s*/, '');
  const match = stripped.match(/(src\/\S+)/);
  if (match) {
    return match[1].replace(/[:>,]+$/, '');
  }
  return stripped.replace(/\s+/g, ' ').trim();
}

export interface CollapseQuarantineDuplicatesResult {
  groups: number;
  survivors: number;
  closed: number;
}

/**
 * Find groups of open `[BUG] flaky test quarantined: ...` todos that share a
 * `quarantineDedupKey` and close every row but the earliest-created survivor.
 */
export async function collapseQuarantineDuplicates(
  project: string,
  deps: QuarantineDedupDeps = {},
): Promise<CollapseQuarantineDuplicatesResult> {
  const listTodosFn = deps.listTodos ?? listTodos;
  const updateTodoFn = deps.updateTodo ?? updateTodo;

  const rows = listTodosFn(project, { includeCompleted: true }).filter(
    (t) => t.title.startsWith(QUARANTINE_TITLE_PREFIX) && t.status !== 'done' && t.status !== 'dropped',
  );

  const byKey = new Map<string, Todo[]>();
  for (const row of rows) {
    const key = quarantineDedupKey(row.title.slice(QUARANTINE_TITLE_PREFIX.length));
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(row);
  }

  let survivors = 0;
  let closed = 0;

  for (const [key, group] of byKey) {
    survivors += 1;
    if (group.length <= 1) continue;

    const sorted = [...group].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const survivor = sorted[0];

    for (const dup of sorted.slice(1)) {
      await updateTodoFn(project, dup.id, {
        status: 'done',
        description: `${dup.description ?? ''}\n\nClosed as duplicate of ${survivor.id} (dedup key: ${key}).`,
      });
      closed += 1;
    }
  }

  return { groups: byKey.size, survivors, closed };
}
