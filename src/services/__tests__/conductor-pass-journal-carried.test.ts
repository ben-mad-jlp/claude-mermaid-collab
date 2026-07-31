import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-sup-carried-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { _resetMissionDbCache, listMissions, listCriteriaWithActions, isMissionTerminal, listCriteria } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo } from '../todo-store';
import { CONDUCTOR_SERVE_BATCH_MAX } from '../harness-caps';
import { listConductorPasses } from '../conductor-pass-journal';

let project: string;

const okInvoke = async () => {
  const missions = listMissions(project);
  const m = missions.find((x) => x.mission.active && !isMissionTerminal(x.mission));
  if (m) {
    for (const c of listCriteriaWithActions(project, m.node.id).filter((x) => x.action === 'discover')) {
      await createTodo(project, { ownerSession: 's1', title: `[EPIC] served ${c.id}`, kind: 'epic', parentId: m.node.id, servesCriterionIds: [c.id] });
    }
  }
  return { ok: true, rateLimited: false, text: 'served the gap' } as any;
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-carried-'));
  _resetMissionDbCache(project);
});

async function forgeApprovedActive() {
  return forgeMission(project, { session: 's1', title: 'The reviewer never over-rejects', criteria: ['a correct leaf is accepted'] });
}

describe('conductor_pass journal — carried rollup', () => {
  test('wide mission records a non-zero carried rollup on the journal row', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const wideCriteria = Array.from({ length: 8 }, (_, i) => `criterion ${i}: gap not yet served`);
    const forged = await forgeMission(project, { session: 's1', title: 'A genuinely wide mission', criteria: wideCriteria });

    const fabricatedVerifyIds = ['fake-verify-1', 'fake-verify-2'];
    const r = await runConductorPass(project, {
      invoke: okInvoke,
      verifyPanelArm: async () => ({ paneled: [], held: [], skipped: [], carried: fabricatedVerifyIds }),
    });

    expect(r.ran).toBe(true);
    const rows = listConductorPasses(project, { missionId: forged.missionId });
    const row = rows[0];
    expect(row.carried).not.toBeNull();
    expect(row.carried!.count).toBe(row.carried!.verify.length + row.carried!.serve.length);
    const expectedServeCount = 8 - CONDUCTOR_SERVE_BATCH_MAX;
    expect(row.carried!.serve.length).toBe(expectedServeCount);
    expect(row.carried!.verify.length).toBe(fabricatedVerifyIds.length);
    expect(row.carried!.count).toBe(expectedServeCount + fabricatedVerifyIds.length);

    // The fabricated verify ids are not real criteria, so they never appear in criteriaActed —
    // unlike the serve-side carried ids, which ARE real criterion ids also listed (pre-node) in
    // criteriaActed alongside every other criterion this pass considered.
    const verifyIntersection = row.carried!.verify.filter((id) => row.criteriaActed.some((a) => a.criterionId === id));
    expect(verifyIntersection.length).toBe(0);
  });

  test('narrow mission records a zero-count carried rollup and an unchanged criteriaActed', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const crit = listCriteria(project, forged.missionId)[0];

    const r = await runConductorPass(project, { invoke: okInvoke });

    expect(r.ran).toBe(true);
    const rows = listConductorPasses(project, { missionId: forged.missionId });
    const row = rows[0];
    expect(row.carried).not.toBeNull();
    expect(row.carried!.count).toBe(0);
    expect(row.carried!.verify).toEqual([]);
    expect(row.carried!.serve).toEqual([]);
    expect(row.criteriaActed).toEqual([
      { criterionId: crit.id, action: 'discover', servedEpicId: null, servedEpicNickname: null },
    ]);
  });
});
