// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, _closeProject } from '../todo-store';
import {
  addCriterion, setCriterionDependsOn, listCriteriaWithActions, upsertMission,
  _resetMissionDbCache, dropCriterion, listCriteria,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { buildWakeContextBlock, ACTIONABLE_ACTIONS, type WakeCriterion } from '../conductor-wake-context';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { runConductorPass } from '../conductor-pass';
import { forgeMission } from '../../mcp/tools/mission-forge';

let project: string;
let invokeCalls: number;
const okInvoke = async () => {
  invokeCalls++;
  return { ok: true, rateLimited: false, text: 'served the gap' } as any;
};

async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  upsertMission(project, t.id);
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'criterion-blocked-read-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  invokeCalls = 0;
  _resetMissionDbCache(project);
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('conductor read-path: blocked-only serve-state is quiet, not stalled', () => {
  test('buildWakeContextBlock renders a discover criterion but not a blocked sibling in the actionable list', async () => {
    const missionId = await makeMissionNode();
    const independent = addCriterion(project, missionId, 'independent unmet criterion');
    const prereq = addCriterion(project, missionId, 'prereq criterion');
    const dependent = addCriterion(project, missionId, 'dependent criterion');
    setCriterionDependsOn(project, dependent.id, [prereq.id]);

    const actions = listCriteriaWithActions(project, missionId);
    expect(actions.find((a) => a.id === independent.id)?.action).toBe('discover');
    expect(actions.find((a) => a.id === dependent.id)?.action).toBe('blocked');

    const wakeCriteria: WakeCriterion[] = actions.map((a) => ({ id: a.id, action: a.action }));
    const block = buildWakeContextBlock({
      missionId, now: Date.now(), lastPassAt: null, openCards: [], actions: wakeCriteria,
    });

    expect(block).toContain(`${independent.id} [discover]`);
    const actionableSection = block.slice(block.indexOf('Criteria ACTIONABLE'));
    expect(actionableSection).not.toContain(dependent.id);
  });

  test('ACTIONABLE_ACTIONS does not include blocked', () => {
    expect(ACTIONABLE_ACTIONS).toEqual(['discover', 'verify']);
    expect(ACTIONABLE_ACTIONS.includes('blocked')).toBe(false);
  });

  test('a blocked-only serve-state returns criteria-blocked without spending a conductor node', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Blocked-only mission',
      criteria: ['prereq criterion', 'dependent criterion'],
    });
    const criteria = listCriteria(project, forged.missionId);
    const prereq = criteria[0];
    const dependent = criteria[1];
    setCriterionDependsOn(project, dependent.id, [prereq.id]);
    // Drop the prereq: it derives 'dropped' (serve-inert, excluded from every other arm) while
    // its unmet-ness still leaves the dependent 'blocked' — the ONLY live, non-dropped action.
    await dropCriterion(project, prereq.id, { reason: 'no longer needed', by: 'test' });

    const actions = listCriteriaWithActions(project, forged.missionId);
    expect(actions.find((a) => a.id === prereq.id)?.action).toBe('dropped');
    expect(actions.find((a) => a.id === dependent.id)?.action).toBe('blocked');
    const discoverIds = actions.filter((a) => a.action === 'discover').map((a) => a.id);
    expect(discoverIds).not.toContain(dependent.id);
    expect(discoverIds.length).toBe(0);

    const result = await runConductorPass(project, { invoke: okInvoke });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('criteria-blocked');
    expect(invokeCalls).toBe(0);
  });
});
