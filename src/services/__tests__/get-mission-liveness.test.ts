import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, _closeProject } from '../todo-store';
import { upsertMission, addCriterion } from '../mission-store';
import { buildMissionDiagnostic } from '../mission-diagnostic';
import { openPassRow, finalizePassRow, _closeConductorJournalDb } from '../conductor-pass-journal';
import { _closeLedgerDb } from '../worker-ledger';
import { handleMissionTool } from '../../mcp/mission-tools';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'get-mission-liveness-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _closeConductorJournalDb();
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

async function makeMission() {
  const m = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title: 'Mission: converge',
    kind: 'mission',
  });
  upsertMission(project, m.id);
  addCriterion(project, m.id, 'the capability under test');
  return m;
}

describe('get_mission conductorPass liveness', () => {
  test('get_mission reads conductorPass.isInflight true when the newest journal row is open', async () => {
    const m = await makeMission();
    openPassRow(project, m.id, 1000);
    const raw = await handleMissionTool('get_mission', { project, todoId: m.id });
    const parsed = JSON.parse(raw!);
    expect(parsed.conductorPass.isInflight).toBe(true);
  });

  test('get_mission reads isInflight false and lastPassAt null with no journal rows', async () => {
    const m = await makeMission();
    const raw = await handleMissionTool('get_mission', { project, todoId: m.id });
    const parsed = JSON.parse(raw!);
    expect(parsed.conductorPass.isInflight).toBe(false);
    expect(parsed.conductorPass.lastPassAt).toBeNull();
  });

  test('get_mission and buildMissionDiagnostic derive the same conductorPass for the same mission', async () => {
    const m = await makeMission();
    const id1 = openPassRow(project, m.id, 1000);
    finalizePassRow(id1!, { outcome: 'ok', ran: true, arm: 'node', endedAt: 1500 });
    const id2 = openPassRow(project, m.id, 2000);
    finalizePassRow(id2!, { outcome: 'debounced', ran: false, arm: 'node', endedAt: 2100 });

    const raw = await handleMissionTool('get_mission', { project, todoId: m.id });
    const parsed = JSON.parse(raw!);
    const diagnostic = await buildMissionDiagnostic(project, m.id, {
      isEpicLandedInGit: async () => 'indeterminate',
    });

    expect(parsed.conductorPass.lastPassAt).toBe(diagnostic.conductorPass.lastPassAt);
    expect(parsed.conductorPass.lastArm).toBe(diagnostic.conductorPass.lastArm);
    expect(parsed.conductorPass.lastOutcome).toBe(diagnostic.conductorPass.lastOutcome);
    expect(parsed.conductorPass.ran).toBe(diagnostic.conductorPass.ran);
    expect(parsed.conductorPass.isInflight).toBe(diagnostic.conductorPass.isInflight);
    expect(parsed.conductorPass.debouncedStreak).toBe(diagnostic.conductorPass.debouncedStreak);
  });
});
