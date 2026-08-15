// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, _closeProject,
} from '../todo-store';
import {
  upsertMission, getMissionRollup, addCriterion,
  setMissionApproved, setCriterionMeasurementPendingUntil, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

/** Create the `[MISSION]` graph node (a top-level durable root). Explicit kind
 *  (decision e852fb0c, stage C) — the title prefix no longer decides role. */
async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-rollup-ao-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('getMissionRollup with awaiting-observation criterion', () => {
  it('reports awaiting-observation with terminalReason null while a measurement window is open', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    setMissionApproved(project, missionId);

    const crit = addCriterion(project, missionId, 'awaiting measurement observation', 'capability');
    setCriterionMeasurementPendingUntil(project, crit.id, Date.now() + 3_600_000);

    const r = getMissionRollup(project, missionId);
    expect(r.status).toBe('awaiting-observation');
    expect(r.terminalReason).toBeNull();
  });

  it('reports stopped false while a measurement window is open', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    setMissionApproved(project, missionId);

    const crit = addCriterion(project, missionId, 'awaiting measurement observation', 'capability');
    setCriterionMeasurementPendingUntil(project, crit.id, Date.now() + 3_600_000);

    const r = getMissionRollup(project, missionId);
    expect(r.stopped).toBe(false);
  });

  it('returns to needs-discovery once the window elapses', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    setMissionApproved(project, missionId);

    const crit = addCriterion(project, missionId, 'past measurement window', 'capability');
    setCriterionMeasurementPendingUntil(project, crit.id, Date.now() - 3_600_000);

    const r = getMissionRollup(project, missionId);
    expect(r.status).toBe('needs-discovery');
  });
});
