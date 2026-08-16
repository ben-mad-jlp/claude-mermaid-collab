// Regression: incident b053b529 (2026-08-14) — a base-red repair LEAF was filed with NO
// parent epic. A parentless leaf is permanently unclaimable, so it sat invisible for 5+
// hours while every epic starved. Three defenses under test here:
//   1. STORE GUARD: creating kind:'leaf' with no parentId throws ParentlessLeafError
//      ('parentless-leaf-refused'), allowOrphan included; a named `bucket` auto-homes
//      instead of throwing. Enforced in production; MERMAID_ENFORCE_PARENTLESS_LEAF=1
//      forces production behaviour under the test runner's fixture hatch.
//   2. FILER MACHINERY: the base-red repair filing path (raiseBaseRepairEpic — what the
//      infra arm now calls even for an unknown lane signature) yields a CLAIMABLE
//      result: a parent epic with baseRepair=1 and the repair leaf homed under it.
//   3. SWEEP: grandfathered parentless rows still read/update fine, and the reconcile
//      sweep raises exactly one deduped card per orphan (no card inside the grace window,
//      no rival card on a second run).
// Runs via `bun test` (uses bun:sqlite).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, getTodo, updateTodo, listTodos, _closeProject,
  ParentlessLeafError, OrphanTodoError,
} from '../todo-store';
import { isBucketEpic } from '../bucket-registry';
import { raiseBaseRepairEpic } from '../base-repair-epic';
import { claimReason } from '../claimability';
import {
  sweepParentlessLeaves, PARENTLESS_LEAF_KIND, PARENTLESS_LEAF_GRACE_MS,
} from '../reconcile-pass';
import { listOpenEscalations, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import type { Todo } from '../todo-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'parentless-leaf-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();
});

afterEach(() => {
  delete process.env.MERMAID_ENFORCE_PARENTLESS_LEAF;
  _closeProject(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

function byIdMap(todos: Todo[]): Map<string, Todo> {
  return new Map(todos.map((t) => [t.id, t]));
}

describe('store guard: parentless-leaf-refused', () => {
  test('a parentless leaf create throws with the guard message', async () => {
    process.env.MERMAID_ENFORCE_PARENTLESS_LEAF = '1';
    await expect(
      createTodo(project, { ownerSession: 's1', title: 'orphan repair leaf' }),
    ).rejects.toThrow(/parentless-leaf-refused: a leaf must be homed under an epic or bucket/);
  });

  test('allowOrphan does NOT exempt a leaf (the b053b529 hole)', async () => {
    process.env.MERMAID_ENFORCE_PARENTLESS_LEAF = '1';
    await expect(
      createTodo(project, { ownerSession: 's1', title: 'orphan via hatch', allowOrphan: true }),
    ).rejects.toThrow(/parentless-leaf-refused/);
  });

  test('the guard error is an OrphanTodoError subclass named for the guard', async () => {
    process.env.MERMAID_ENFORCE_PARENTLESS_LEAF = '1';
    let thrown: unknown;
    try {
      await createTodo(project, { ownerSession: 's1', title: 'orphan', allowOrphan: true });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ParentlessLeafError);
    expect(thrown).toBeInstanceOf(OrphanTodoError); // HTTP/MCP 4xx mapping keeps matching
    expect((thrown as ParentlessLeafError).name).toBe('ParentlessLeafError');
    expect((thrown as ParentlessLeafError).message).toContain('parentless-leaf-refused');
  });

  test('a named bucket auto-homes instead of throwing', async () => {
    process.env.MERMAID_ENFORCE_PARENTLESS_LEAF = '1';
    const leaf = await createTodo(project, {
      ownerSession: 's1', title: 'homed repair leaf', bucket: 'bugfix',
    });
    expect(leaf.parentId).not.toBeNull();
    const parent = getTodo(project, leaf.parentId!)!;
    expect(isBucketEpic(parent)).toBe(true);
  });

  test('epics, missions and parented leaves are unaffected', async () => {
    process.env.MERMAID_ENFORCE_PARENTLESS_LEAF = '1';
    const epic = await createTodo(project, {
      ownerSession: 's1', title: '[EPIC] fine', kind: 'epic', missionId: null,
    });
    expect(epic.kind).toBe('epic');
    const mission = await createTodo(project, {
      ownerSession: 's1', title: '[MISSION] fine', kind: 'mission',
    });
    expect(mission.kind).toBe('mission');
    const child = await createTodo(project, {
      ownerSession: 's1', title: 'parented leaf', parentId: epic.id,
    });
    expect(child.parentId).toBe(epic.id);
  });
});

describe('base-red filing path (raiseBaseRepairEpic) yields a claimable, homed result', () => {
  test('parent epic exists with baseRepair=1 and the leaf is homed under it', async () => {
    const result = await raiseBaseRepairEpic({
      project,
      session: 's1',
      epicId: 'aaaaaaaa1111',
      targetProject: project,
      laneSignature: '<unknown>', // the master/trunk base-red case: signature unknown
      trunkRef: 'master',
      cause: 'epic-base-red',
      reasonTail: 'master base red: 3 file(s) FAILED',
      epicBranch: 'master',
    });

    expect(result.created).toBe(true);
    const epic = getTodo(project, result.epicId!)!;
    expect(epic.kind).toBe('epic');
    expect(epic.baseRepair).toBe(1);

    const todos = listTodos(project, { includeCompleted: true });
    const leaves = todos.filter((t) => t.parentId === epic.id);
    expect(leaves.length).toBe(1);
    expect(leaves[0].parentId).toBe(epic.id); // homed, never a bare todo
    expect(claimReason(leaves[0], byIdMap(todos))).toBe('claimable');
  });
});

describe('grandfathered orphans: read/update fine; sweep cards exactly once per orphan', () => {
  /** Pre-guard row: the bun-test fixture hatch (NODE_ENV=test, enforcement env unset)
   *  mints a genuinely parentless leaf, standing in for a grandfathered live row. */
  async function grandfatheredOrphan(title: string): Promise<Todo> {
    const t = await createTodo(project, { ownerSession: 's1', title, allowOrphan: true });
    expect(t.parentId).toBeNull();
    return t;
  }

  test('existing parentless rows still read and update fine', async () => {
    const orphan = await grandfatheredOrphan('pre-guard orphan');
    expect(getTodo(project, orphan.id)!.title).toBe('pre-guard orphan');
    const updated = await updateTodo(project, orphan.id, { priority: 2 });
    expect(updated.priority).toBe(2);
    expect(updated.parentId).toBeNull(); // untouched — grandfathered, not rewritten
  });

  test('sweep raises exactly one card per orphan and dedupes on a second run', async () => {
    const a = await grandfatheredOrphan('orphan A');
    const b = await grandfatheredOrphan('orphan B');
    const past = Date.now() + PARENTLESS_LEAF_GRACE_MS + 60_000;

    const first = sweepParentlessLeaves(project, { now: past });
    expect(first.sort()).toEqual([a.id, b.id].sort());

    const cards = listOpenEscalations({ project, kind: PARENTLESS_LEAF_KIND });
    expect(cards.length).toBe(2);

    const second = sweepParentlessLeaves(project, { now: past });
    expect(second).toEqual([]); // deduped — no rival cards
    expect(listOpenEscalations({ project, kind: PARENTLESS_LEAF_KIND }).length).toBe(2);
  });

  test('an orphan inside the grace window is not carded; terminal orphans never are', async () => {
    const fresh = await grandfatheredOrphan('fresh orphan');
    expect(sweepParentlessLeaves(project, { now: Date.now() })).toEqual([]);

    await updateTodo(project, fresh.id, { status: 'dropped' });
    const past = Date.now() + PARENTLESS_LEAF_GRACE_MS + 60_000;
    expect(sweepParentlessLeaves(project, { now: past })).toEqual([]);
    expect(listOpenEscalations({ project, kind: PARENTLESS_LEAF_KIND }).length).toBe(0);
  });
});
