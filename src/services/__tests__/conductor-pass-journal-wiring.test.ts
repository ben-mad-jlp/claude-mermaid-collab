import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let SUP_DIR: string;

beforeEach(() => {
  SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-journal-sup-'));
  process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;
});

import { runConductorPass } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { _resetMissionDbCache, listMissions, listCriteriaWithActions, isMissionTerminal, CRITERION_SERVE_CAP } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo, updateTodo } from '../todo-store';
import { openPassRow, appendPassProgress, listConductorPasses, _closeConductorJournalDb } from '../conductor-pass-journal';

let project: string;
let invokeCalls: number;

const okInvoke = async () => {
  invokeCalls++;
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
  project = mkdtempSync(join(tmpdir(), 'conductor-journal-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
  _closeConductorJournalDb();
});

async function forgeApprovedActive() {
  return forgeMission(project, { session: 's1', title: 'The reviewer never over-rejects', criteria: ['a correct leaf is accepted'] });
}

describe('conductor-pass-journal wiring', () => {
  test('wires a productive pass into one conducted journal row with missionId, arm, and filed', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.reason).toBe('conducted');

    const rows = listConductorPasses(project);
    expect(rows.length).toBe(1);
    expect(rows[0].outcome).toBe('conducted');
    expect(rows[0].missionId).toBe(forged.missionId);
    expect(rows[0].arm).toBe('node');
    expect(rows[0].filed).toBeTruthy();
    expect(rows[0].declined).toEqual([]);
  });

  test('wires a debounced pass into a journal row with declined explaining why', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    await runConductorPass(project, { invoke: okInvoke });
    const r2 = await runConductorPass(project, { invoke: okInvoke });
    expect(r2.reason).toBe('debounced');

    const rows = listConductorPasses(project);
    expect(rows.length).toBe(2);
    const secondRow = rows[0]; // newest-first
    expect(secondRow.outcome).toBe('debounced');
    expect(secondRow.declined.length).toBeGreaterThan(0);
  });

  test('a killed pass leaves a readable row with startedAt, missionId, and outcome null', () => {
    const rowId = openPassRow(project, null, Date.now());
    expect(rowId).not.toBeNull();
    appendPassProgress(rowId!, { missionId: 'mission-abc' });

    const rows = listConductorPasses(project);
    expect(rows.length).toBe(1);
    expect(rows[0].startedAt).toBeGreaterThan(0);
    expect(rows[0].missionId).toBe('mission-abc');
    expect(rows[0].outcome).toBeNull();
  });

  test('wires a redecomposed pass into a journal row with typed filed epic refs', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const crit = listCriteriaWithActions(project, forged.missionId)[0];

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      infraArm: (async () => ({ candidates: [], reset: [], cardsRaised: 0, skipped: [], baseRepairEpics: [], reapedBaseRepairEpics: [] })) as any,
      cardTriageArm: (async () => ({ parked: [], skipped: [] })) as any,
      redecomposeArm: (async () => ({ redecomposed: [{ criterionId: crit.id, epicId: 'epic-redec-1' }], skipped: [] })) as any,
    });
    expect(r.reason).toBe('redecomposed');

    const row = listConductorPasses(project)[0];
    expect(row.arm).toBe('redecompose');
    expect(Array.isArray(row.filed)).toBe(true);
    expect(row.filed).toEqual([
      { kind: 'epic', id: 'epic-redec-1', title: `re-decomposed: ${crit.text}` },
    ]);
  });

  test('wires a serve-cap escalation pass into a journal row with typed filed card refs and servedEpicId', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const crit = listCriteriaWithActions(project, forged.missionId)[0];

    // Burn the criterion's serve cap so its derived action is 'escalate' with an exhausted ladder.
    const epicIds: string[] = [];
    for (let i = 0; i < CRITERION_SERVE_CAP; i++) {
      const e = await createTodo(project, {
        ownerSession: 's1', title: `[EPIC] served ${i}`, kind: 'epic',
        parentId: forged.missionId, servesCriterionIds: [crit.id],
      });
      // A still-open serving epic derives 'building'. Dropped serves stay in the LIFETIME
      // serve count (the thrash history) while leaving no live/landed epic, which is exactly
      // the burned-cap-and-still-unmet shape that derives 'escalate'. Dropped epics are also
      // serve-inert in servingEpicsByComp, so servedEpicId is null.
      await updateTodo(project, e.id, { status: 'dropped' });
      epicIds.push(e.id);
    }

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: (() => ({ isNew: true, escalation: { id: 'esc-serve-cap-1', status: 'open' } })) as any,
      closeArm: (async () => ({ minted: false, why: 'not-test-only' })) as any,
      infraArm: (async () => ({ candidates: [], reset: [], cardsRaised: 0, skipped: [], baseRepairEpics: [], reapedBaseRepairEpics: [] })) as any,
      cardTriageArm: (async () => ({ parked: [], skipped: [] })) as any,
      redecomposeArm: (async () => ({ redecomposed: [], skipped: [] })) as any,
    });
    expect(r.escalationsRaised).toBe(1);

    const row = listConductorPasses(project)[0];
    expect(row.filed).toEqual([
      { kind: 'card', id: 'esc-serve-cap-1', title: `serve-cap: ${crit.text.slice(0, 80)}` },
    ]);
    const acted = row.criteriaActed.find((a) => a.criterionId === crit.id);
    expect(acted).toBeTruthy();
    expect(acted!.servedEpicId).toBeNull();
    expect(epicIds.length).toBe(CRITERION_SERVE_CAP);
  });

  test('journal export failures degrade to a normal pass, no throw', async () => {
    mock.module('../conductor-pass-journal', () => ({
      openPassRow: () => { throw new Error('x'); },
      appendPassProgress: () => { throw new Error('x'); },
      finalizePassRow: () => { throw new Error('x'); },
    }));

    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.reason).toBe('conducted');

    mock.restore();
  });
});
