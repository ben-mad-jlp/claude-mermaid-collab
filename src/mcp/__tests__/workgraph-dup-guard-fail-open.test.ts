// The duplicate-of-done guard (src/services/leaf-dup-guard.ts, incident a6ab522b) must FAIL
// OPEN: any internal error while scanning the mission closure must never block a legitimate
// filing. The error is induced with REAL data rather than mock.module — a bun `mock.module`
// registration is process-global and leaks into every other test file in the same run, and
// this repo runs the whole backend suite in one process.
//
// Induction: a sibling row under the mission is left with a NULL `kind`, which makes
// todo-kind's kindOf() throw MissingKindError inside buildMissionDoneLeafIndex — the same
// shape as any store/schema hiccup on the scan path. It has to be NULL rather than a garbage
// string: collab.db constrains `kind` to the five real values (CHECK ... IN), and a CHECK
// tolerates NULL, so NULL is the only unreadable kind the schema still permits on disk.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleWorkgraphTool } from '../workgraph-tools';
import { createTodo, updateTodo, listTodos, openDb, _closeProject } from '../../services/todo-store';
import { buildMissionDoneLeafIndex } from '../../services/leaf-dup-guard';

let project: string;
const S = 's1';

beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'workgraph-dup-failopen-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const out = await handleWorkgraphTool(name, { project, session: S, ...args });
  return JSON.parse(out!);
}

/** Blank one row's `kind` column directly — no public API can produce this state.
 *  The handle comes from the store rather than `new Database(...)`: the consolidated
 *  collab.db is created, migrated and FK-enabled by openDb, and nothing on disk exists
 *  before it has run. */
function clearKind(id: string): void {
  openDb(project).prepare('UPDATE todos SET kind = NULL WHERE id = ?').run(id);
}

const DUP_TITLE = 'Yield a stalled leader\'s turn to an actionable rival in deterministic-select';

describe('duplicate-of-done guard fails open', () => {
  test('an internal error in the dup scan does NOT block filing — the leaf is created', async () => {
    const m = await createTodo(project, {
      allowOrphan: true, ownerSession: S, title: '[MISSION] fail-open', kind: 'mission',
    });
    const epic = await call('create_epic', { title: 'Serving epic', home: m.id, servesCriterionIds: ['c1'] });

    // A prior ACCEPTED leaf with the exact same title — the guard WOULD refuse this filing.
    const first = await call('add_leaves', { epicId: epic.epicId, leaves: [{ title: DUP_TITLE }] });
    await updateTodo(project, first.createdIds[0], { status: 'done', acceptanceStatus: 'accepted' });

    // Break the scan: a second mission child whose kind is unreadable.
    const decoy = await createTodo(project, {
      allowOrphan: true, ownerSession: S, title: 'corrupt sibling', kind: 'epic', parentId: m.id,
    });
    clearKind(decoy.id);
    _closeProject(project); // drop the cached handle so the corrupted row is re-read

    // Precondition: the scan really does throw now.
    expect(() => buildMissionDoneLeafIndex(project, m.id)).toThrow();

    const second = await call('add_leaves', { epicId: epic.epicId, leaves: [{ title: DUP_TITLE }] });
    expect(second.createdIds).toHaveLength(1);
    const children = listTodos(project, { includeCompleted: true }).filter((t) => t.parentId === epic.epicId);
    expect(children).toHaveLength(2);
  });
});
