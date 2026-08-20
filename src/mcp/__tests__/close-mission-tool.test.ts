import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addCriterion, setCriterionMet, listCriteria, getMission,
  _resetMissionDbCache,
} from '../../services/mission-store.js';
import { handleMissionTool } from '../mission-tools.js';
import { _closeDb as closeSupervisorDb } from '../../services/supervisor-store.js';
import { _closeProject } from '../../services/todo-store.js';

let project: string;
const session = 'test-session-123';
let missionTodoId: string;

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'close-mission-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;

  // Create a mission using the MCP tool (which sets up the mission row properly)
  // Include a criterion so the mission doesn't auto-converge and self-heal
  const createResult = await handleMissionTool('create_mission', {
    project,
    session,
    title: 'Test Mission',
    criteria: ['Placeholder criterion'],
  });
  const parsed = JSON.parse(createResult!);
  missionTodoId = parsed.mission.todoId;
});

afterEach(() => {
  _resetMissionDbCache(project);
  _closeProject(project);
  closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('close_mission', () => {
  it('close_mission stamps closedAt and closedBy via the mission store', async () => {
    // The mission was created with one placeholder criterion. Find it.
    let criteria = listCriteria(project, missionTodoId);
    expect(criteria.length).toBe(1);
    const crit = criteria[0];

    // Verify the mission starts with null closure info (while criterion is still unmet)
    let mission = getMission(project, missionTodoId);
    expect(mission?.closedAt).toBeNull();
    expect(mission?.closedBy).toBeNull();

    // Mark the criterion met so close_mission will perform a clean closure
    setCriterionMet(project, crit.id, true);

    // Call close_mission via MCP (this should be a clean closure since all criteria are now met)
    const result = await handleMissionTool('close_mission', {
      project,
      missionId: missionTodoId,
      attribution: 'test-judge',
      evidence: 'All criteria met',
    });

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.missionId).toBe(missionTodoId);
    expect(typeof parsed.closedAt).toBe('number');
    expect(parsed.closedBy).toBe('test-judge');

    // Verify it persisted in the store
    mission = getMission(project, missionTodoId);
    expect(mission?.closedAt).not.toBeNull();
    expect(mission?.closedBy).toBe('test-judge');
  });

  it('close_mission returns an error object for an unknown mission and writes nothing', async () => {
    const unknownId = 'nonexistent-mission-id-12345';

    // Call close_mission with a non-existent mission ID
    const result = await handleMissionTool('close_mission', {
      project,
      missionId: unknownId,
      attribution: 'test-judge',
    });

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/mission not found/);

    // Verify nothing was written by checking the mission we created is still unmodified
    const mission = getMission(project, missionTodoId);
    expect(mission?.closedAt).toBeNull();
    expect(mission?.closedBy).toBeNull();
  });
});
