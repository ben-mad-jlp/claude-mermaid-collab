import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stable supervisor dir (watched_project + escalation + ledger stores); per-test project dir keeps
// the mission/todo stores fresh.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-infra-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import {
  classifyInfraRejection,
  collectInfraRejectedLeaves,
  runInfraRejectionArm,
  infraRejectedMarker,
  INFRA_REJECTED_KIND,
  type EpicBaseProbe,
} from '../conductor-infra-arm';
import { runConductorPass, conductorFingerprint } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled, listEscalations } from '../supervisor-store';
import { _resetMissionDbCache, listCriteria, listCriteriaWithActions, getMission, stampConductorRun } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo, updateTodo, getTodo, deriveTodoViews } from '../todo-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { recordNode } from '../worker-ledger';

let project: string;

const BASE_RED_REASON = 'epic-base-red: npx tsc --noEmit\n--- output (tail) ---\nerror TS2345';
const CONTENT_REASON = 'review findings: the fix does not cover the empty-input case\nVERDICT: FAIL';

const passProbe: EpicBaseProbe = async () => 'pass';
const failProbe: EpicBaseProbe = async () => 'fail';

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-infra-'));
  _resetMissionDbCache(project);
  addWatchedProject(project);
  setConductorEnabled(project, true);
  setOrchestratorLevel(project, 'on');
});

/** Forge an approved+active mission with ONE serving epic carrying ONE rejected leaf whose
 *  durable terminal ledger reason is `reason`. */
async function seedRejectedLeaf(reason: string) {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Base repair drives stuck leaves',
    criteria: ['a leaf parked on a red base re-dispatches once the base is green'],
  });
  const crit = listCriteria(project, forged.missionId)[0];
  const epic = await createTodo(project, {
    ownerSession: 's1',
    title: '[EPIC] serving epic',
    kind: 'epic',
    parentId: forged.missionId,
    servesCriterionIds: [crit.id],
  });
  // Released epic + approved leaf: the ONLY thing keeping the leaf out of the claimable set
  // must be its own rejection, so the reset's effect is unambiguous.
  await updateTodo(project, epic.id, { status: 'ready' });
  const leaf = await createTodo(project, {
    ownerSession: 's1',
    title: 'the stuck leaf',
    parentId: epic.id,
    status: 'ready',
  });
  await updateTodo(project, leaf.id, { acceptanceStatus: 'rejected' });
  // The terminal outcome marker listLeafRuns reads for finalOutcome + reason.
  recordNode({
    project,
    todoId: leaf.id,
    epicId: epic.id,
    leafId: leaf.id,
    session: 's1',
    nodeKind: 'outcome',
    nodesSpent: 0,
    leafOutcome: 'rejected',
    outcomeDetail: JSON.stringify({ reason }),
  });
  return { forged, crit, epic, leaf };
}

describe('classifyInfraRejection', () => {
  test('maps the three INFRA heads and returns null for a review-findings reason', () => {
    expect(classifyInfraRejection(BASE_RED_REASON)).toBe('epic-base-red');
    expect(classifyInfraRejection('epic-base-gate-could-not-run: npx tsc --noEmit')).toBe('epic-base-gate-could-not-run');
    expect(classifyInfraRejection('mis-homed target: leaf ran in the tracking repo')).toBe('mis-homed-target');
    // CONTENT — the fail-closed default. Never auto-reset.
    expect(classifyInfraRejection(CONTENT_REASON)).toBeNull();
    expect(classifyInfraRejection(null)).toBeNull();
    expect(classifyInfraRejection('empty diff: the leaf changed nothing')).toBeNull();
  });
});

describe('runInfraRejectionArm', () => {
  test('base-red leaf + a re-probe that says pass ⇒ leaf is un-parked and re-dispatchable', async () => {
    const { forged, leaf } = await seedRejectedLeaf(BASE_RED_REASON);
    const candidates = collectInfraRejectedLeaves(project, forged.missionId);
    expect(candidates.map((c) => c.leafId)).toEqual([leaf.id]);
    expect(candidates[0].cause).toBe('epic-base-red');

    const r = await runConductorPass(project, {
      invoke: async () => { throw new Error('no node should be spawned on a reset pass'); },
      epicBaseProbe: passProbe,
    });
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('infra-leaf-reset');
    expect(r.infraResets).toBe(1);

    const after = getTodo(project, leaf.id)!;
    expect(after.acceptanceStatus).toBeNull();
    expect(deriveTodoViews(project, [after])[0].derivedStatus).toBe('ready');
  });

  test('base-red leaf + a probe that stays fail ⇒ exactly ONE card, deduped on the next pass', async () => {
    const { forged, leaf } = await seedRejectedLeaf(BASE_RED_REASON);
    const before = listEscalations().length;

    const a = await runInfraRejectionArm(project, forged.missionId, 's1', { probe: failProbe });
    expect(a.reset).toEqual([]);
    expect(a.cardsRaised).toBe(1);
    const cards = listEscalations().filter((e) => e.kind === INFRA_REJECTED_KIND && e.project === project);
    expect(cards.length).toBe(1);
    expect(cards[0].todoId).toBe(leaf.id);
    expect(cards[0].questionText).toContain(infraRejectedMarker(leaf.id));
    const afterFirst = listEscalations().length;
    expect(afterFirst).toBe(before + 1);

    // Same state, second pass: the open card dedupes — no second card.
    const b = await runInfraRejectionArm(project, forged.missionId, 's1', { probe: failProbe });
    expect(b.cardsRaised).toBe(0);
    expect(listEscalations().length).toBe(afterFirst);
    expect(getTodo(project, leaf.id)!.acceptanceStatus).toBe('rejected');
  });

  test('CONTENT rejection is never touched — no reset, no card', async () => {
    const { forged, leaf } = await seedRejectedLeaf(CONTENT_REASON);
    expect(collectInfraRejectedLeaves(project, forged.missionId)).toEqual([]);

    const r = await runInfraRejectionArm(project, forged.missionId, 's1', { probe: passProbe });
    expect(r.candidates).toEqual([]);
    expect(r.reset).toEqual([]);
    expect(r.cardsRaised).toBe(0);
    expect(getTodo(project, leaf.id)!.acceptanceStatus).toBe('rejected');
  });

  test('debounce break: an INFRA-rejected leaf reopens a state the conductor already served', async () => {
    const { forged } = await seedRejectedLeaf(BASE_RED_REASON);
    // Pre-stamp the EXACT fingerprint this state produces, so the pass would otherwise debounce.
    const status = getMission(project, forged.missionId)!.status!;
    const actions = listCriteriaWithActions(project, forged.missionId)
      .map((a) => ({ action: a.action, id: a.id, rejectedParked: a.rejectedParkedCount }));
    stampConductorRun(project, forged.missionId, `${conductorFingerprint(status, actions)}|land:0`);

    let invoked = 0;
    const r = await runConductorPass(project, {
      invoke: async () => { invoked++; return { ok: true, rateLimited: false, text: 'looked at the stuck leaf' } as any; },
      epicBaseProbe: failProbe,
    });
    expect(r.reason).not.toBe('debounced');
    expect(r.infraCards).toBe(1);
    expect(invoked).toBe(1);
  });
});
