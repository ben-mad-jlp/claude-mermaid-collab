/**
 * conductor-debounce-derived — proves the success-debounce key and the fail-retry counter are
 * derived from the conductor_pass journal (countConsecutiveFailedPasses / latestProductivePassFp),
 * not from the mission table's lastConductorKey/lastConductorSelfKey string columns.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-debounce-derived-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass, type ConductorPassDeps } from '../conductor-pass';
import { CONDUCTOR_SERVE_RETRY_CAP } from '../harness-caps';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { _resetMissionDbCache, getMission } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { setOrchestratorLevel } from '../orchestrator-config';
import { openPassRow, finalizePassRow } from '../conductor-pass-journal';

let project: string;
let invokeCalls: number;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-debounce-derived-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
  addWatchedProject(project);
  setConductorEnabled(project, true);
  setOrchestratorLevel(project, 'on');
});

const tick = (over: ConductorPassDeps = {}) => runConductorPass(project, { invoke: emptyServeInvoke, ...over });

/** The LLM-no-op mock: returns ok but files no epic, so the productive-pass guard treats it as
 *  a failed attempt (node-failed), not a success. */
const emptyServeInvoke = async () => {
  invokeCalls++;
  return { ok: true, rateLimited: false, text: 'looked but did nothing' } as any;
};

describe('conductor debounce derived from the journal', () => {
  test('derives priorFails from countConsecutiveFailedPasses over journal rows, capping after CONDUCTOR_SERVE_RETRY_CAP contiguous fails even though the mission column holds only a plain fingerprint', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Undelegatable criterion never re-serves on its own',
      criteria: ['a live measurement cannot be automated'],
    });
    const missionId = forged.missionId;

    // One real failing pass to learn the actual serveFp it stamps.
    const first = await tick();
    expect(first.reason).toBe('node-failed');

    const row = getMission(project, missionId)!;
    const serveFp = row.lastConductorKey!;
    expect(serveFp.includes('|fail:')).toBe(false);

    // Seed CONDUCTOR_SERVE_RETRY_CAP - 1 additional finalized node-failed journal rows for the
    // same (project, missionId, serveFp), so the contiguous run (including the real pass above)
    // reaches CONDUCTOR_SERVE_RETRY_CAP.
    let startedAt = Date.now() + 1000;
    for (let i = 0; i < CONDUCTOR_SERVE_RETRY_CAP - 1; i++) {
      const id = openPassRow(project, missionId, startedAt) as string;
      finalizePassRow(id, { endedAt: startedAt + 500, serveFp, outcome: 'node-failed', ran: true });
      startedAt += 1000;
    }

    const rowAfterSeed = getMission(project, missionId)!;
    expect(rowAfterSeed.lastConductorKey).toBe(serveFp);
    expect(rowAfterSeed.lastConductorKey!.includes('|fail:')).toBe(false);

    const cappedInvokeCalls = invokeCalls;
    const capped = await tick();
    expect(capped.reason).toBe('debounced');
    expect(invokeCalls).toBe(cappedInvokeCalls);
  });

  test('a productive journal row appended after a fail run un-caps a later pass on the same serveFp', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Undelegatable criterion never re-serves on its own',
      criteria: ['a live measurement cannot be automated'],
    });
    const missionId = forged.missionId;

    const first = await tick();
    expect(first.reason).toBe('node-failed');
    const serveFp = getMission(project, missionId)!.lastConductorKey!;

    let startedAt = Date.now() + 1000;
    for (let i = 0; i < CONDUCTOR_SERVE_RETRY_CAP - 1; i++) {
      const id = openPassRow(project, missionId, startedAt) as string;
      finalizePassRow(id, { endedAt: startedAt + 500, serveFp, outcome: 'node-failed', ran: true });
      startedAt += 1000;
    }

    const capped = await tick();
    expect(capped.reason).toBe('debounced');

    // A productive journal row for this same (project, missionId, serveFp) un-caps the run.
    const productiveId = openPassRow(project, missionId, startedAt) as string;
    finalizePassRow(productiveId, {
      endedAt: startedAt + 500,
      serveFp,
      passFp: `${serveFp}-uncapped`,
      selfFp: `${serveFp}-uncapped-self`,
      outcome: 'conducted',
      ran: true,
    });

    const uncapped = await tick();
    expect(uncapped.reason).not.toBe('debounced');
  });
});
