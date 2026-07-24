// Runs via `bun test` (bun:sqlite). Coverage for the three work-graph constructor
// verbs (create_epic / add_leaves / file_to_bucket) plus the cross-verb invariant
// (no floating todo; every non-bucket epic has exactly one live land leaf).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleWorkgraphTool, WORKGRAPH_TOOL_DEFS } from '../workgraph-tools';
import { getTodo, listTodos, _closeProject, createTodo, updateTodo, splitLeafInto } from '../../services/todo-store';
import { isMission } from '../../services/todo-kind';
import { isBucketEpic } from '../../services/bucket-registry';
import { trackingProjectRoot } from '../../services/project-registry';

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
  test('mints an epic row only, no land leaf child (case 1)', async () => {
    const res = await call('create_epic', { title: 'Ship the widget' });
    expect(res.epicId).toBeTruthy();
    expect(res.epic).toBeTruthy();
    expect(res.epic.id).toBe(res.epicId);
    const { createdIds } = await call('add_leaves', {
      epicId: res.epicId,
      leaves: [{ title: 'a build leaf' }],
    });
    const children = listTodos(project, { includeCompleted: true }).filter((t) => t.parentId === res.epicId);
    expect(children.map((c) => c.id).sort()).toEqual([...createdIds].sort());
    expect(children.every((c) => c.kind !== 'land')).toBe(true);
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

describe('serve-time criterion-edge guard', () => {
  async function freshMission(title = '[MISSION] guard test'): Promise<string> {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title,
      kind: 'mission',
    });
    return mission.id;
  }

  test('mission-homed create_epic with NO servesCriterionIds rejects and leaves no orphan epic', async () => {
    const missionId = await freshMission();
    await expect(call('create_epic', { title: 'Unserved epic', home: missionId })).rejects.toThrow(
      /servesCriterionIds/,
    );
    const orphans = listTodos(project, { includeCompleted: true }).filter((t) => t.parentId === missionId);
    expect(orphans).toEqual([]);
  });

  test('mission-homed create_epic criterion-edge rejection carries code missing-criterion-edge', async () => {
    const missionId = await freshMission();
    let caught: any;
    try {
      await call('create_epic', { title: 'Unserved epic 2', home: missionId });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('missing-criterion-edge');
  });

  test('mission-homed create_epic WITH servesCriterionIds succeeds, parentId is the mission', async () => {
    const missionId = await freshMission();
    const res = await call('create_epic', { title: 'Served epic', home: missionId, servesCriterionIds: ['c1'] });
    expect(getTodo(project, res.epicId)!.parentId).toBe(missionId);
  });

  test('root epic (home:null) with no edge still succeeds (regression)', async () => {
    const res = await call('create_epic', { title: 'Root, no edge', home: null });
    expect(getTodo(project, res.epicId)!.parentId).toBeNull();
  });

  test('add_leaves refuses when parent epic is mission-homed but the mission node is unreadable', async () => {
    const missionId = await freshMission();
    const res = await call('create_epic', { title: 'Served epic 2', home: missionId, servesCriterionIds: ['c1'] });
    // Simulate an unreadable mission node by re-parenting the epic to a bogus id that
    // still looks mission-homed (parentId set) but resolves to nothing via getTodo.
    await updateTodo(project, res.epicId, { parentId: 'not-a-real-mission-id' });
    await expect(
      call('add_leaves', { epicId: res.epicId, leaves: [{ title: 'x' }] }),
    ).rejects.toThrow(/mission-homed but its mission node .* is unreadable/);
  });
});

describe('cross-project target inheritance', () => {
  const OTHER = '/tmp/other-implementation-repo';

  test('cross-project mission propagates through create_epic + add_leaves', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] x-proj',
      kind: 'mission',
    });
    await updateTodo(project, mission.id, { targetProject: OTHER });

    const epic = await call('create_epic', { title: 'Ship it', home: mission.id, servesCriterionIds: ['c1'] });
    expect(getTodo(project, epic.epicId)!.targetProject).toBe(OTHER);

    const { createdIds } = await call('add_leaves', {
      epicId: epic.epicId,
      leaves: [{ title: 'l1' }, { title: 'l2' }],
    });
    for (const id of createdIds) {
      expect(getTodo(project, id)!.targetProject).toBe(OTHER);
    }
  });

  test('add_leaves rejects when the epic does not match its mission\'s cross-project targetProject', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] x-proj mismatch',
      kind: 'mission',
    });

    // Create the epic while the mission is still same-project so it never inherits OTHER,
    // then flip the mission's targetProject afterwards to force a divergence.
    const epic = await call('create_epic', { title: 'Stale target epic', home: mission.id, servesCriterionIds: ['c1'] });
    await updateTodo(project, mission.id, { targetProject: OTHER });

    let caught: any;
    try {
      await call('add_leaves', { epicId: epic.epicId, leaves: [{ title: 'x' }] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(String(caught.message)).toMatch(/missing-target-project|targetProject/);
    expect(caught.code).toBe('missing-target-project');

    const children = listTodos(project, { includeCompleted: true }).filter((t) => t.parentId === epic.epicId);
    expect(children).toEqual([]);
  });

  test('same-project mission (no targetProject) leaves epic + leaves at the tracking root', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: S,
      title: '[MISSION] same',
      kind: 'mission',
    });

    const epic = await call('create_epic', { title: 'Ship it too', home: mission.id, servesCriterionIds: ['c1'] });
    expect(getTodo(project, epic.epicId)!.targetProject).toBe(trackingProjectRoot(project));

    const { createdIds } = await call('add_leaves', {
      epicId: epic.epicId,
      leaves: [{ title: 'l1' }, { title: 'l2' }],
    });
    for (const id of createdIds) {
      expect(getTodo(project, id)!.targetProject).toBe(trackingProjectRoot(project));
    }
  });

  test('splitLeafInto children inherit the leaf\'s cross-project target', async () => {
    const epic = await call('create_epic', { title: 'Root for split', home: null });
    const { createdIds } = await call('add_leaves', { epicId: epic.epicId, leaves: [{ title: 'to split' }] });
    const leafId = createdIds[0];
    await updateTodo(project, leafId, { targetProject: OTHER });
    const leaf = getTodo(project, leafId)!;

    const { childIds } = await splitLeafInto(project, leaf, ['a.ts', 'b.ts']);
    expect(childIds.length).toBe(2);
    for (const cid of childIds) {
      expect(getTodo(project, cid)!.targetProject).toBe(OTHER);
    }
  });
});

test('INVARIANT: scripted sequence keeps no floating todo + a non-bucket epic gating children are exactly its build children (case 10)', async () => {
  const epic = await call('create_epic', { title: 'Deliverable epic', home: null });
  const { createdIds } = await call('add_leaves', { epicId: epic.epicId, leaves: [{ title: 'leaf A' }, { title: 'leaf B' }] });
  await call('file_to_bucket', { title: 'a stray thought' });

  const all = listTodos(project, { includeCompleted: true });

  // (a) every non-bucket, non-dropped epic's gating (non-dropped) children are exactly its build children — no land child is minted.
  for (const t of all) {
    if (t.kind !== 'epic' || t.status === 'dropped' || isBucketEpic(t)) continue;
    const gatingChildren = all.filter((c) => c.parentId === t.id && c.status !== 'dropped');
    if (t.id === epic.epicId) {
      expect(gatingChildren.map((c) => c.id).sort()).toEqual([...createdIds].sort());
    }
    expect(gatingChildren.every((c) => c.kind !== 'land')).toBe(true);
  }

  // (b) every non-bucket, non-mission todo has a non-null parentId (no floater) —
  //     epics themselves are the exception (roots), so only leaf/land nodes are checked.
  for (const t of all) {
    if (t.status === 'dropped') continue;
    if (t.kind === 'epic' || isMission(t) || isBucketEpic(t)) continue;
    expect(t.parentId).not.toBeNull();
  }
});
