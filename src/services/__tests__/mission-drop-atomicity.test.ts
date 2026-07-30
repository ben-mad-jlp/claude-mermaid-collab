import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-drop-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-drop-'));
});

import { handleMissionTool } from '../../mcp/mission-tools';
import { getTodo, claimTodo, stampMissionNodeApprovedIfNull, _closeProject as closeTodos } from '../todo-store';
import { getMission, listCriteria, _resetMissionDbCache } from '../mission-store';

afterEach(() => {
  _resetMissionDbCache(project);
  closeTodos(project);
  rmSync(project, { recursive: true, force: true });
});

describe('delete_mission atomicity', () => {
  test('a failed drop (live-claimed mission node) leaves mission control rows and criteria intact', async () => {
    const created = JSON.parse(await handleMissionTool('create_mission', {
      project, session: 's1', title: 't', criteria: ['a', 'b'],
    }) as string);
    const missionId = created.node.id;

    stampMissionNodeApprovedIfNull(project, missionId, 'test-approver');
    const claimed = await claimTodo(project, missionId, 'worker-1', 60000);
    expect(claimed).not.toBeNull();

    await expect(handleMissionTool('delete_mission', { project, todoId: missionId })).rejects.toThrow();

    expect(getTodo(project, missionId)!.status).not.toBe('dropped');
    expect(getMission(project, missionId)).toBeDefined();
    expect(listCriteria(project, missionId).length).toBe(2);
  });

  test('a successful delete_mission still fully tears down control rows', async () => {
    const created = JSON.parse(await handleMissionTool('create_mission', {
      project, session: 's1', title: 't2', criteria: ['a', 'b'],
    }) as string);
    const missionId2 = created.node.id;

    await expect(handleMissionTool('delete_mission', { project, todoId: missionId2 })).resolves.toBeDefined();

    expect(getMission(project, missionId2)).toBeUndefined();
    expect(listCriteria(project, missionId2).length).toBe(0);
  });
});
