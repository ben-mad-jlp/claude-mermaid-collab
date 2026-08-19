// pruneOrphanMissions must never destroy a freshly-forged mission: the caller's
// liveNodeIds set can be a STALE todos snapshot (taken at tick start), so absence
// from the set is a hint, not proof. Three missions lost their control rows and
// criteria to this race on 2026-08-19 (unrecoverable). The guard is two-layer:
// a direct todos-table read (a live node is never an orphan) and an age grace
// window (a genuinely-absent row younger than an hour is a write race, not junk).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _closeProject } from '../todo-store';
import {
  _resetMissionDbCache,
  pruneOrphanMissions,
  getMissionRaw,
  PRUNE_ORPHAN_GRACE_MS,
} from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { openCollabDb } from '../collab-db';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'prune-orphan-grace-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

test('a mission forged seconds ago with a live todo survives the prune sweep', async () => {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Fresh mission the stale snapshot cannot see',
    criteria: ['Criterion A is satisfied'],
  });
  const missionId = forged.missionId;

  // Simulate the race: the caller's snapshot predates the forge, so the live set is empty.
  const pruned = pruneOrphanMissions(project, new Set<string>());

  expect(pruned).toBe(0);
  expect(getMissionRaw(project, missionId) ?? null).not.toBeNull();
});

test('a control row whose todo has been gone past the grace window is still pruned', async () => {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Mission whose graph node truly vanished',
    criteria: ['Criterion A is satisfied'],
  });
  const missionId = forged.missionId;

  // Make it a REAL orphan: mark the graph node dropped (deleting the todos row would
  // cascade the mission row away via the FK) and age the control row past the grace
  // window. The production path simulated is a node dropped outside delete_mission.
  const db = openCollabDb(project);
  db.prepare("UPDATE todos SET status = 'dropped' WHERE id = ?").run(missionId);
  db.prepare('UPDATE mission SET createdAt = ? WHERE todoId = ?').run(
    Date.now() - PRUNE_ORPHAN_GRACE_MS - 60_000,
    missionId,
  );

  const pruned = pruneOrphanMissions(project, new Set<string>());

  expect(pruned).toBe(1);
  expect(getMissionRaw(project, missionId) ?? null).toBeNull();
});

test('a genuinely-absent row inside the grace window is left for a later sweep', async () => {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Absent node, young row',
    criteria: ['Criterion A is satisfied'],
  });
  const missionId = forged.missionId;

  const db = openCollabDb(project);
  db.prepare("UPDATE todos SET status = 'dropped' WHERE id = ?").run(missionId);

  const pruned = pruneOrphanMissions(project, new Set<string>());

  expect(pruned).toBe(0);
  expect(getMissionRaw(project, missionId) ?? null).not.toBeNull();
});
