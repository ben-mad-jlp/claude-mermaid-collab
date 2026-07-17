// Runs via `bun test` (bun:sqlite). Coverage for the three work-graph constructor
// verbs (create_epic / add_leaves / file_to_bucket) plus the cross-verb invariant
// (no floating todo; every non-bucket epic has exactly one live land leaf).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleWorkgraphTool, WORKGRAPH_TOOL_DEFS } from '../workgraph-tools';
import { getTodo, listTodos, _closeProject } from '../../services/todo-store';
import { isMission } from '../../services/todo-kind';
import { isBucketEpic } from '../../services/bucket-registry';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'workgraph-tools-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

const S = 's1';

// The defs carry NO per-def `handler` (dispatch is centralized in handleWorkgraphTool,
// mirroring MISSION_TOOL_DEFS) — assert that here so the pattern stays intact.
test('tool defs are handler-less (dispatch is centralized)', () => {
  for (const def of WORKGRAPH_TOOL_DEFS) {
    expect((def as Record<string, unknown>).handler).toBeUndefined();
  }
  expect(WORKGRAPH_TOOL_DEFS.map((d) => d.name).sort()).toEqual(['add_leaves', 'create_epic', 'file_to_bucket']);
});

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const out = await handleWorkgraphTool(name, { project, session: S, ...args });
  expect(out).not.toBeNull();
  return JSON.parse(out!);
}

describe('create_epic', () => {
  test('mints an epic WITH a land leaf (case 1)', async () => {
    const res = await call('create_epic', { title: 'Ship the widget' });
    expect(res.epicId).toBeTruthy();
    expect(res.landLeafId).toBeTruthy();
    const landLeaf = getTodo(project, res.landLeafId)!;
    expect(landLeaf.kind).toBe('land');
    expect(landLeaf.parentId).toBe(res.epicId);
    expect(landLeaf.assigneeKind).toBe('human');
    expect(landLeaf.title.endsWith('→ master')).toBe(true);
  });

  test('home:null creates a ROOT epic with no parent (case 2)', async () => {
    const res = await call('create_epic', { title: 'Root epic', home: null });
    const epic = getTodo(project, res.epicId)!;
    expect(epic.parentId).toBeNull();
  });

  test('a bucket title is refused (case 3)', async () => {
    await expect(call('create_epic', { title: 'Inbox' })).rejects.toThrow();
    await expect(call('create_epic', { title: 'Bugfix inbox' })).rejects.toThrow();
  });

  test('home:"null" (literal string) throws the guard, does not mission-home (case 4)', async () => {
    await expect(call('create_epic', { title: 'Trap epic', home: 'null' })).rejects.toThrow(/literal string/i);
  });
});

describe('add_leaves', () => {
  async function freshEpic(title = 'Parent epic'): Promise<string> {
    const res = await call('create_epic', { title, home: null });
    return res.epicId;
  }

  test('resolves intra-batch dependsOn $0 refs (case 5)', async () => {
    const epicId = await freshEpic();
    const res = await call('add_leaves', {
      epicId,
      leaves: [
        { title: 'First leaf' },
        { title: 'Second leaf', dependsOn: ['$0'] },
      ],
    });
    expect(res.createdIds).toHaveLength(2);
    const second = getTodo(project, res.createdIds[1])!;
    expect(second.dependsOn).toEqual([res.createdIds[0]]);
  });

  test('against a bucket epic throws (case 6)', async () => {
    // file a leaf to force-create the Inbox bucket, then resolve its parent id.
    const filed = await call('file_to_bucket', { title: 'a thought' });
    const bucketId = getTodo(project, filed.leaf.id)!.parentId!;
    await expect(call('add_leaves', { epicId: bucketId, leaves: [{ title: 'x' }] })).rejects.toThrow(/quick-capture/);
  });

  test('against a non-epic (leaf) id throws (case 7)', async () => {
    const epicId = await freshEpic();
    const res = await call('add_leaves', { epicId, leaves: [{ title: 'a leaf' }] });
    const leafId = res.createdIds[0];
    await expect(call('add_leaves', { epicId: leafId, leaves: [{ title: 'nested' }] })).rejects.toThrow(/must be an epic/);
  });

  test('a forward / out-of-range $N ref is rejected', async () => {
    const epicId = await freshEpic();
    await expect(
      call('add_leaves', { epicId, leaves: [{ title: 'only', dependsOn: ['$0'] }] }),
    ).rejects.toThrow(/out of range/);
  });
});

describe('file_to_bucket', () => {
  test('default inbox lands under the Inbox bucket; fields round-trip (case 8)', async () => {
    const res = await call('file_to_bucket', {
      title: 'unplanned thought',
      description: 'some detail',
      priority: 2,
      status: 'planned',
      link: { blueprintId: 'bp-123' },
    });
    const leaf = getTodo(project, res.leaf.id)!;
    const parent = getTodo(project, leaf.parentId!)!;
    expect(isBucketEpic(parent)).toBe(true);
    expect(parent.bucketType).toBe('inbox');
    expect(leaf.description).toBe('some detail');
    expect(leaf.priority).toBe(2);
    expect(leaf.status).toBe('planned');
    expect(leaf.link?.blueprintId).toBe('bp-123');
  });

  test('bucket:bugfix lands under a DISTINCT bugfix bucket (case 9)', async () => {
    const inbox = await call('file_to_bucket', { title: 'inbox item' });
    const bugfix = await call('file_to_bucket', { title: 'a bug', bucket: 'bugfix' });
    const inboxParent = getTodo(project, inbox.leaf.id)!.parentId!;
    const bugfixParent = getTodo(project, bugfix.leaf.id)!.parentId!;
    expect(bugfixParent).not.toBe(inboxParent);
    expect(getTodo(project, bugfixParent)!.bucketType).toBe('bugfix');
  });
});

test('INVARIANT: scripted sequence keeps no floating todo + one land leaf per non-bucket epic (case 10)', async () => {
  const epic = await call('create_epic', { title: 'Deliverable epic', home: null });
  await call('add_leaves', { epicId: epic.epicId, leaves: [{ title: 'leaf A' }, { title: 'leaf B' }] });
  await call('file_to_bucket', { title: 'a stray thought' });

  const all = listTodos(project, { includeCompleted: true });

  // (a) every non-bucket, non-dropped epic has exactly one live land child.
  for (const t of all) {
    if (t.kind !== 'epic' || t.status === 'dropped' || isBucketEpic(t)) continue;
    const liveLandChildren = all.filter((c) => c.parentId === t.id && c.kind === 'land' && c.status !== 'dropped');
    expect(liveLandChildren).toHaveLength(1);
  }

  // (b) every non-bucket, non-mission todo has a non-null parentId (no floater) —
  //     epics themselves are the exception (roots), so only leaf/land nodes are checked.
  for (const t of all) {
    if (t.status === 'dropped') continue;
    if (t.kind === 'epic' || isMission(t) || isBucketEpic(t)) continue;
    expect(t.parentId).not.toBeNull();
  }
});
