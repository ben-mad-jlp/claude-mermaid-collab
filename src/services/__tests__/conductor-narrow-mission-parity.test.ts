import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'narrow-parity-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runVerifyPanelArm } from '../conductor-verify-panel-arm';
import { runConductorPass } from '../conductor-pass';
import { buildWakeContextBlock, type WakeCriterion } from '../conductor-wake-context';
import { listConductorPasses } from '../conductor-pass-journal';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import {
  _resetMissionDbCache,
  listMissions,
  listCriteria,
  listCriteriaWithActions,
  isMissionTerminal,
} from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo, updateTodo } from '../todo-store';
import { recordNode } from '../worker-ledger';
import { CONDUCTOR_VERIFY_BATCH_MAX, CONDUCTOR_SERVE_BATCH_MAX } from '../harness-caps';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'narrow-parity-'));
  _resetMissionDbCache(project);
});

describe('narrow-mission parity — batching machinery is inert below the bound', () => {
  test('runs every criterion when the verify mission is exactly CONDUCTOR_VERIFY_BATCH_MAX wide', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);

    const criteriaTitles = Array.from({ length: CONDUCTOR_VERIFY_BATCH_MAX }, (_, i) => `verify criterion ${i}`);
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Exactly batch-width verify',
      criteria: criteriaTitles,
    });
    const crits = listCriteria(project, forged.missionId);
    expect(crits.length).toBe(CONDUCTOR_VERIFY_BATCH_MAX);

    for (const crit of crits) {
      const epic = await createTodo(project, {
        ownerSession: 's1',
        title: `[EPIC] serving epic for ${crit.id}`,
        kind: 'epic',
        parentId: forged.missionId,
        servesCriterionIds: [crit.id],
      });
      const leaf = await createTodo(project, {
        ownerSession: 's1',
        title: 'the leaf',
        parentId: epic.id,
        servesCriterionIds: [crit.id],
      });
      await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
      await updateTodo(project, epic.id, { status: 'done' });
      recordNode({
        project,
        todoId: leaf.id,
        epicId: epic.id,
        leafId: leaf.id,
        session: 's1',
        leafOutcome: 'completed',
      });
    }

    let panelCallCount = 0;
    const countingRunPanel = async (_p: string, _cid: string, _deps: any) => {
      panelCallCount++;
      return { skipped: undefined, hold: false, met: true, invocations: 1 };
    };

    const result = await runVerifyPanelArm(project, forged.missionId, 's1', {
      runPanel: countingRunPanel,
    });

    expect(panelCallCount).toBe(CONDUCTOR_VERIFY_BATCH_MAX);
    expect((result.carried ?? []).length).toBe(0);
    expect(result.paneled.length).toBe(CONDUCTOR_VERIFY_BATCH_MAX);
  });

  test('renders every discover gap with no CARRIED line when exactly CONDUCTOR_SERVE_BATCH_MAX wide', () => {
    const NOW = 1_800_000_000_000;
    const LAST_PASS = NOW - 60 * 60 * 1000;
    const discoverGaps: WakeCriterion[] = Array.from({ length: CONDUCTOR_SERVE_BATCH_MAX }, (_, i) => ({
      id: `crit-discover-${i}`,
      action: 'discover',
      text: `gap ${i}`,
    }));

    const block = buildWakeContextBlock({
      missionId: 'm1',
      now: NOW,
      lastPassAt: LAST_PASS,
      openCards: [],
      actions: discoverGaps,
    });

    const renderedIds = discoverGaps.filter((g) => block.includes(g.id));
    expect(renderedIds.length).toBe(CONDUCTOR_SERVE_BATCH_MAX);
    expect(block).not.toMatch(/CARRIED to the next pass \(serve bound/);
  });

  test('narrow mission journal row has an empty carried rollup and unchanged criteriaActed', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);

    const forged = await forgeMission(project, {
      session: 's1',
      title: 'A single verify criterion',
      criteria: ['a correct leaf is accepted'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: `[EPIC] serving epic for ${crit.id}`,
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
    await updateTodo(project, epic.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    const actionable = listCriteriaWithActions(project, forged.missionId).find((c) => c.id === crit.id);
    expect(actionable?.action).toBe('verify');

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

    const r = await runConductorPass(project, { invoke: okInvoke });

    expect(r.ran).toBe(true);
    const rows = listConductorPasses(project, { missionId: forged.missionId });
    const row = rows[0];
    expect(row.carried).not.toBeNull();
    expect(row.carried!.count).toBe(0);
    expect(row.carried!.verify).toEqual([]);
    expect(row.carried!.serve).toEqual([]);
    expect(row.criteriaActed.length).toBe(1);
    expect(row.criteriaActed[0].criterionId).toBe(crit.id);
    expect(row.criteriaActed[0].action).toBe('verify');
  });
});
