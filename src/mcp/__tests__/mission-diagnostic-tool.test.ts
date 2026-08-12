import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

mock.module('../../services/epic-landedness.js', () => ({
  isEpicLandedInGit: async () => 'landed',
}));

import { createTodo, _closeProject } from '../../services/todo-store';
import { upsertMission, addCriterion } from '../../services/mission-store';
import { handleMissionTool } from '../mission-tools';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-diagnostic-tool-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission_diagnostic MCP tool', () => {
  test('landedInGit true for a land commit on trunk with landedAt unset', async () => {
    const m = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Mission: converge',
      kind: 'mission',
    });
    upsertMission(project, m.id);
    const c = addCriterion(project, m.id, 'the capability under test');
    const e = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serve',
      kind: 'epic',
      parentId: m.id,
      servesCriterionIds: [c.id],
    });

    const raw = await handleMissionTool('mission_diagnostic', { project, missionId: m.id });
    expect(raw).not.toBeNull();
    const diagnostic = JSON.parse(raw!);
    const crit = diagnostic.criteria[0];
    const servingEpic = crit.servingEpics.find((s: { id: string }) => s.id === e.id);
    expect(servingEpic.landedInGit).toBe(true);
  });

  test('throws synchronously without missionId/todoId', async () => {
    await expect(handleMissionTool('mission_diagnostic', { project })).rejects.toThrow(
      'Missing required: project, missionId',
    );
  });

  test('rejects a non-absolute project name instead of an empty-but-healthy diagnostic', async () => {
    await expect(
      handleMissionTool('mission_diagnostic', { project: 'mermaid-collab', missionId: 'deadbeef' }),
    ).rejects.toThrow(/mermaid-collab/);
  });
});
