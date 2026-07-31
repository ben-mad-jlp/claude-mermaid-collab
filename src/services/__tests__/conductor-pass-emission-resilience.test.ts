import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-emission-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { _resetMissionDbCache, listMissions, listCriteriaWithActions, isMissionTerminal } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo } from '../todo-store';
import { initializeWebSocketHandler } from '../ws-handler-manager';
import { listConductorPasses } from '../conductor-pass-journal';
import * as journalReal from '../conductor-pass-journal';

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
  project = mkdtempSync(join(tmpdir(), 'conductor-emission-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
});

afterEach(() => {
  initializeWebSocketHandler(null as any);
  mock.restore();
});

async function forgeApprovedActive() {
  return forgeMission(project, { session: 's1', title: 'The reviewer never over-rejects', criteria: ['a correct leaf is accepted'] });
}

describe('conductor_pass emission resilience', () => {
  test('a pass that throws from both WS broadcast and the enrichment read still returns a normal result and seals the journal row', async () => {
    const realListConductorPasses = listConductorPasses;
    mock.module('../conductor-pass-journal', () => ({
      ...journalReal,
      listConductorPasses: () => {
        throw new Error('enrichment read boom');
      },
    }));

    initializeWebSocketHandler({
      broadcast: () => {
        throw new Error('broadcast boom');
      },
    } as any);

    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();

    const r = await runConductorPass(project, { invoke: okInvoke });

    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted');

    mock.restore();

    const rows = realListConductorPasses(project, { limit: 5 });
    const sealed = rows.find((row) => row.missionId === r.missionId);
    expect(sealed).toBeDefined();
    expect(sealed!.endedAt).not.toBeNull();
    expect(sealed!.outcome).not.toBeNull();
  });
});
