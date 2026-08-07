// Integration test proving that deleting a mission retires decision-record constraints
// solely linked to it — driven through the production MCP entrypoint (delete_mission) and
// through the self-heal path (pruneOrphanMissions), never a raw store/SQL call.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, getTodo, _closeProject } from '../todo-store';
import { _resetMissionDbCache, pruneOrphanMissions } from '../mission-store';
import {
  getActiveConstraints,
  getDecisionRecord,
  createDecisionRecord,
  approveDecisionRecord,
  _closeProject as _closeDecisionRecordProject,
} from '../decision-record-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { handleMissionTool } from '../../mcp/mission-tools';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-constraint-retirement-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _closeDecisionRecordProject(project);
  _resetMissionDbCache(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

test('delete_mission via handleMissionTool supersedes a constraint solely linked to the deleted mission', async () => {
  const session = 's1';
  const forged = await forgeMission(project, {
    session,
    title: 'Converge on X',
    criteria: ['Criterion A is satisfied'],
    constraints: [{ rule: 'Never touch the payments table directly' }],
  });
  const missionId = forged.missionId;
  const recId = forged.constraints[0].id;

  expect(getActiveConstraints(project).some((r) => r.id === recId)).toBe(true);

  await handleMissionTool('delete_mission', { project, todoId: missionId });

  expect(getActiveConstraints(project).some((r) => r.id === recId)).toBe(false);
  const rec = getDecisionRecord(project, recId);
  expect(rec?.status).toBe('superseded');
});

test('delete_mission via handleMissionTool keeps a constraint active when it is also linked to a live todo, and drops the mission id from linkedTodos', async () => {
  const session = 's1';
  const forged = await forgeMission(project, {
    session,
    title: 'Converge on Y',
    criteria: ['Criterion A is satisfied'],
  });
  const missionId = forged.missionId;

  const otherTodo = await createTodo(project, { allowOrphan: true, ownerSession: session, title: 'other' });
  const rec = createDecisionRecord(project, {
    kind: 'constraint',
    title: 'Shared constraint',
    linkedTodos: [missionId, otherTodo.id],
    authorSession: session,
  });
  approveDecisionRecord(project, rec.id, session);

  await handleMissionTool('delete_mission', { project, todoId: missionId });

  const after = getDecisionRecord(project, rec.id);
  expect(after?.status).toBe('active');
  expect(getActiveConstraints(project).some((r) => r.id === rec.id)).toBe(true);
  expect(after?.linkedTodos).not.toContain(missionId);
});

test('pruneOrphanMissions retires constraints for an orphaned mission the same way as delete_mission', async () => {
  const session = 's1';
  const forged = await forgeMission(project, {
    session,
    title: 'Converge on Z',
    criteria: ['Criterion A is satisfied'],
    constraints: [{ rule: 'Never bypass the review gate' }],
  });
  const missionId = forged.missionId;
  const recId = forged.constraints[0].id;

  expect(getActiveConstraints(project).some((r) => r.id === recId)).toBe(true);

  pruneOrphanMissions(project, new Set());

  expect(getActiveConstraints(project).some((r) => r.id === recId)).toBe(false);
  const rec = getDecisionRecord(project, recId);
  expect(rec?.status).toBe('superseded');
});
