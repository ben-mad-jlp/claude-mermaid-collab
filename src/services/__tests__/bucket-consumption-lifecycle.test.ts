// Regression tests for reopening consumed-but-undelivered bucket items when their
// consumer (epic or mission) is dropped, abandoned, or deleted before it lands/converges.
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  getTodo,
  updateTodo,
  stampEpicLandedAt,
  _closeProject,
} from '../todo-store';
import { ensureBucket } from '../bucket-registry';
import { consumeBucketItems } from '../bucket-consumption';
import {
  upsertMission,
  addCriterion,
  dropCriterion,
  setMissionAbandoned,
  deleteMission,
  _resetMissionDbCache,
} from '../mission-store';
import { createEpicWithLandLeaf } from '../../mcp/workgraph-tools';

function freshProject(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'bucket-consumption-lifecycle-'));
  mkdirSync(join(dir, '.collab'), { recursive: true });
  return dir;
}

const projects: string[] = [];
afterEach(() => {
  for (const p of projects.splice(0)) {
    _closeProject(p);
    _resetMissionDbCache(p);
    rmSync(p, { recursive: true, force: true });
  }
});

async function makeTwoBucketLeaves(project: string) {
  const bucketId = await ensureBucket(project, 'bugfix');
  const leaf1 = await createTodo(project, {
    ownerSession: 's',
    kind: 'leaf',
    title: 'Bug 1',
    parentId: bucketId,
  });
  const leaf2 = await createTodo(project, {
    ownerSession: 's',
    kind: 'leaf',
    title: 'Bug 2',
    parentId: bucketId,
  });
  return [leaf1.id, leaf2.id];
}

describe('bucket-consumption-lifecycle: reopen on drop/abandon/delete', () => {
  test('dropping an undelivered epic consumer reopens its consumed bucket items', async () => {
    const project = freshProject();
    projects.push(project);

    const leafIds = await makeTwoBucketLeaves(project);
    const epicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Consumer epic',
      inbox: true,
    })).id;

    await consumeBucketItems(project, leafIds, { id: epicId, kind: 'epic' });
    for (const id of leafIds) {
      expect(getTodo(project, id)!.status).toBe('done');
    }

    await updateTodo(project, epicId, { status: 'dropped' });

    for (const id of leafIds) {
      const row = getTodo(project, id)!;
      expect(row.status).toBe('planned');
      expect(row.promotedTo).toBeNull();
      expect(row.consumedAt).toBeNull();
    }
  });

  test('dropping a serving criterion reopens its consumed bucket items', async () => {
    const project = freshProject();
    projects.push(project);

    const session = 's';
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: session,
      title: 'Converge on X',
      kind: 'mission',
    });
    upsertMission(project, mission.id);
    const crit = addCriterion(project, mission.id, 'Criterion A is satisfied');

    const { epic } = await createEpicWithLandLeaf(project, session, {
      title: 'Deliverable A',
      home: mission.id,
      homeProvided: true,
      servesCriterionIds: [crit.id],
    });

    const leafIds = await makeTwoBucketLeaves(project);
    await consumeBucketItems(project, leafIds, { id: epic.id, kind: 'epic' });
    for (const id of leafIds) {
      expect(getTodo(project, id)!.status).toBe('done');
    }

    await dropCriterion(project, crit.id, { reason: 'test', by: 's' });

    expect(getTodo(project, epic.id)!.status).toBe('dropped');
    for (const id of leafIds) {
      const row = getTodo(project, id)!;
      expect(row.status).toBe('planned');
      expect(row.promotedTo).toBeNull();
      expect(row.consumedAt).toBeNull();
    }
  });

  test('abandoning an unconverged mission reopens its consumed bucket items', async () => {
    const project = freshProject();
    projects.push(project);

    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[MISSION] abandon-reopen',
      kind: 'mission',
    });
    upsertMission(project, mission.id);

    const leafIds = await makeTwoBucketLeaves(project);
    await consumeBucketItems(project, leafIds, { id: mission.id, kind: 'mission' });
    for (const id of leafIds) {
      expect(getTodo(project, id)!.status).toBe('done');
    }

    await setMissionAbandoned(project, mission.id, Date.now());

    for (const id of leafIds) {
      const row = getTodo(project, id)!;
      expect(row.status).toBe('planned');
      expect(row.promotedTo).toBeNull();
      expect(row.consumedAt).toBeNull();
    }
  });

  test('deleting a mission reopens its consumed bucket items', async () => {
    const project = freshProject();
    projects.push(project);

    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's',
      title: '[MISSION] delete-reopen',
      kind: 'mission',
    });
    upsertMission(project, mission.id);

    const leafIds = await makeTwoBucketLeaves(project);
    await consumeBucketItems(project, leafIds, { id: mission.id, kind: 'mission' });
    for (const id of leafIds) {
      expect(getTodo(project, id)!.status).toBe('done');
    }

    deleteMission(project, mission.id);

    for (const id of leafIds) {
      const row = getTodo(project, id)!;
      expect(row.status).toBe('planned');
      expect(row.promotedTo).toBeNull();
      expect(row.consumedAt).toBeNull();
    }
  });

  test('dropping a landed (delivered) epic does NOT reopen its consumed bucket items', async () => {
    const project = freshProject();
    projects.push(project);

    const leafIds = await makeTwoBucketLeaves(project);
    const epicId = (await createTodo(project, {
      ownerSession: 's',
      kind: 'epic',
      title: 'Landed consumer epic',
      inbox: true,
    })).id;

    await consumeBucketItems(project, leafIds, { id: epicId, kind: 'epic' });
    stampEpicLandedAt(project, epicId, new Date().toISOString());

    await updateTodo(project, epicId, { status: 'dropped' });

    for (const id of leafIds) {
      const row = getTodo(project, id)!;
      expect(row.status).toBe('done');
      expect(row.promotedTo).toBe(epicId);
    }
  });
});
