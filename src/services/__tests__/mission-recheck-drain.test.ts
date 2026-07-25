import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'drain-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { drainMissionRechecks } from '../mission-recheck-drain';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { _resetMissionDbCache, listCriteria, enqueueRecheck, listPendingRechecks, setMissionAbandoned, setMissionClosed, setCriterionVerdict } from '../mission-store';
import { _resetMissionSpendMemo } from '../ledger-stats';
import { runConductorPass } from '../conductor-pass';
import { setOrchestratorLevel } from '../orchestrator-config';
import { _resetAuthCache, _resetClaudeBinCache } from '../../agent/node-invoker';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'drain-'));
  _resetMissionDbCache(project);
  _resetMissionSpendMemo();
  _resetAuthCache();
  _resetClaudeBinCache();
});

describe('drainMissionRechecks', () => {
  test('row on an abandoned mission is GCd', async () => {
    const forged = await forgeMission(project, { session: 's1', title: 'Test mission', criteria: ['Test criterion'] });
    const crit = listCriteria(project, forged.missionId)[0];
    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'test' });

    setMissionAbandoned(project, forged.missionId, Date.now());

    const result = drainMissionRechecks(project, forged.missionId);
    expect(result.cleared).toContain(crit.id);
    expect(listPendingRechecks(project)).toHaveLength(0);
  });

  test('row on a closed mission is GCd', async () => {
    const forged = await forgeMission(project, { session: 's1', title: 'Test mission', criteria: ['Test criterion'] });
    const crit = listCriteria(project, forged.missionId)[0];
    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'test' });

    setMissionClosed(project, forged.missionId, Date.now());

    const result = drainMissionRechecks(project, forged.missionId);
    expect(result.cleared).toContain(crit.id);
    expect(listPendingRechecks(project)).toHaveLength(0);
  });

  test('row whose criterion has verifiedAt is GCd', async () => {
    const forged = await forgeMission(project, { session: 's1', title: 'Test mission', criteria: ['Test criterion'] });
    const crit = listCriteria(project, forged.missionId)[0];
    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'test' });

    setCriterionVerdict(project, crit.id, { met: true, evidence: 'proof', verifiedBy: 'test', verifiedAtSha: 'abc123' });

    const result = drainMissionRechecks(project, forged.missionId);
    expect(result.cleared).toContain(crit.id);
    expect(listPendingRechecks(project)).toHaveLength(0);
  });

  test('row on the driven live mission with an unverified criterion survives', async () => {
    const forged = await forgeMission(project, { session: 's1', title: 'Test mission', criteria: ['Test criterion'] });
    const crit = listCriteria(project, forged.missionId)[0];
    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'test' });

    const result = drainMissionRechecks(project, forged.missionId);
    expect(result.cleared).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].criterionId).toBe(crit.id);
    expect(listPendingRechecks(project)).toHaveLength(1);
  });

  test('row on a non-driven live mission survives and is not returned as pending', async () => {
    const forged1 = await forgeMission(project, { session: 's1', title: 'Mission 1', criteria: ['Criterion 1'] });
    const forged2 = await forgeMission(project, { session: 's2', title: 'Mission 2', criteria: ['Criterion 2'] });
    const crit1 = listCriteria(project, forged1.missionId)[0];
    const crit2 = listCriteria(project, forged2.missionId)[0];

    enqueueRecheck(project, { criterionId: crit1.id, todoId: forged1.missionId, reason: 'test' });
    enqueueRecheck(project, { criterionId: crit2.id, todoId: forged2.missionId, reason: 'test' });

    const result = drainMissionRechecks(project, forged1.missionId);
    expect(result.cleared).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].todoId).toBe(forged1.missionId);
    expect(listPendingRechecks(project)).toHaveLength(2);
  });

  test('runConductorPass drains rechecks for the driven mission', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    setOrchestratorLevel(project, 'on');

    const forged = await forgeMission(project, { session: 's1', title: 'Test mission', criteria: ['Test criterion'] });
    const crit = listCriteria(project, forged.missionId)[0];

    const abandoned = await forgeMission(project, { session: 's2', title: 'Abandoned mission', criteria: ['Abandoned criterion'] });
    const critAbandoned = listCriteria(project, abandoned.missionId)[0];
    enqueueRecheck(project, { criterionId: critAbandoned.id, todoId: abandoned.missionId, reason: 'test' });
    setMissionAbandoned(project, abandoned.missionId, Date.now());

    const okInvoke = async () => ({
      ok: true,
      rateLimited: false,
      text: 'no gaps',
    } as any);

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.rechecksDrained).toBeGreaterThan(0);
    expect(listPendingRechecks(project)).toHaveLength(0);
  });
});
