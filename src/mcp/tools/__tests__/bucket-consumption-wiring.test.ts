import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'bucket-consumption-wiring-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { forgeMission } from '../mission-forge';
import { planMissionCriterion } from '../mission-planner';
import { listCriteria, _resetMissionDbCache } from '../../../services/mission-store';
import { getTodo, createTodo, _closeProject as closeTodos } from '../../../services/todo-store';
import { _closeProject as closeDecisions } from '../../../services/decision-record-store';
import { ensureBucket } from '../../../services/bucket-registry';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'bucket-consumption-wiring-')); _resetMissionDbCache(project); });
afterEach(() => { _resetMissionDbCache(project); closeTodos(project); closeDecisions(project); rmSync(project, { recursive: true, force: true }); });

describe('bucket consumption wired into forge_mission and plan_mission_criterion', () => {
  test('forgeMission consumes named bucket leaves and leaves the rest open', async () => {
    const bucketId = await ensureBucket(project, 'inbox');
    const leaf1 = await createTodo(project, { ownerSession: 's1', kind: 'leaf', title: 'Bucket leaf 1', parentId: bucketId });
    const leaf2 = await createTodo(project, { ownerSession: 's1', kind: 'leaf', title: 'Bucket leaf 2', parentId: bucketId });
    const leaf3 = await createTodo(project, { ownerSession: 's1', kind: 'leaf', title: 'Bucket leaf 3', parentId: bucketId });

    const r = await forgeMission(project, {
      session: 's1',
      title: 'Address the two named bucket items',
      criteria: ['the two named bucket items are resolved'],
      consumesTodoIds: [leaf1.id, leaf2.id],
    });

    expect(r.consumedBucketItems.consumed.sort()).toEqual([leaf1.id, leaf2.id].sort());

    const row1 = getTodo(project, leaf1.id)!;
    const row2 = getTodo(project, leaf2.id)!;
    const row3 = getTodo(project, leaf3.id)!;

    expect(row1.status).toBe('done');
    expect(row1.promotedTo).toBe(r.missionId);
    expect(row2.status).toBe('done');
    expect(row2.promotedTo).toBe(r.missionId);

    expect(row3.status).not.toBe('done');
    expect(row3.promotedTo).toBeNull();
  });

  test('planMissionCriterion consumes bucket leaves named in the planner spec', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'The reviewer never over-rejects',
      criteria: ['doubt over a green gate abstains'],
    });
    const criterionId = listCriteria(project, forged.missionId)[0].id;

    const bucketId = await ensureBucket(project, 'bugfix');
    const namedLeaf = await createTodo(project, { ownerSession: 's1', kind: 'leaf', title: 'Named bug', parentId: bucketId });
    const unnamedLeaf = await createTodo(project, { ownerSession: 's1', kind: 'leaf', title: 'Unnamed bug', parentId: bucketId });

    const EPIC_SPEC = {
      title: 'Fix the named bug as part of this epic',
      description: 'Addresses the named bucket item.',
      leaves: [
        { title: 'fix the bug', description: 'edit the relevant file', files: ['src/services/leaf-executor.ts'] },
      ],
      consumes: [namedLeaf.id],
    };
    const invoke = async () => ({ ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(EPIC_SPEC) + '\n```' } as any);

    const r = await planMissionCriterion(project, { session: 's1', missionId: forged.missionId, criterionIds: [criterionId] }, { invoke });

    expect(r.consumedBucketItems.consumed).toEqual([namedLeaf.id]);

    const namedRow = getTodo(project, namedLeaf.id)!;
    expect(namedRow.status).toBe('done');
    expect(namedRow.promotedTo).toBe(r.epicId);

    const unnamedRow = getTodo(project, unnamedLeaf.id)!;
    expect(unnamedRow.status).not.toBe('done');
    expect(unnamedRow.promotedTo).toBeNull();
  });
});
