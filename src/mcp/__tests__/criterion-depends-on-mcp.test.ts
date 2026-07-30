// Round-trip of criterion `dependsOn` through the MCP surface: add_mission_criterion
// persists it, update_mission_criterion can set it without touching text, a cycle-closing
// edge is rejected with the store's own error, and get_mission carries the field back out.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMissionTool } from '../mission-tools';
import { _closeProject } from '../../services/todo-store';
import { listCriteria } from '../../services/mission-store';
import { _closeDb } from '../../services/supervisor-store';

let project: string;
const S = 's_test';

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'criterion-depends-on-mcp-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

async function callMissionTool(name: string, args: Record<string, unknown>): Promise<any> {
  const out = await handleMissionTool(name, { project, ...args });
  return JSON.parse(out!);
}

// add_mission_criterion requires the mission CONTROL row (getMission), not just the graph
// node — so mint the mission through its own tool rather than createTodo alone.
async function makeMission(title: string): Promise<{ id: string }> {
  const res = await callMissionTool('create_mission', { session: S, title });
  return { id: res.node.id as string };
}

describe('criterion dependsOn via MCP', () => {
  test('add_mission_criterion persists and returns dependsOn', async () => {
    const mission = await makeMission('dependsOn add');
    const b = await callMissionTool('add_mission_criterion', {
      todoId: mission.id, text: 'B: the prerequisite holds',
    });
    const a = await callMissionTool('add_mission_criterion', {
      todoId: mission.id, text: 'A: the dependent holds', dependsOn: [b.criterion.id],
    });

    expect(a.criterion.dependsOn).toEqual([b.criterion.id]);

    const rows = listCriteria(project, mission.id);
    const stored = rows.find((r) => r.id === a.criterion.id)!;
    expect(stored.dependsOn).toEqual([b.criterion.id]);
  });

  test('update_mission_criterion accepts dependsOn without text, leaving text unchanged', async () => {
    const mission = await makeMission('dependsOn update');
    const b = await callMissionTool('add_mission_criterion', {
      todoId: mission.id, text: 'B: the prerequisite holds',
    });
    const a = await callMissionTool('add_mission_criterion', {
      todoId: mission.id, text: 'A: the dependent holds', dependsOn: [b.criterion.id],
    });

    await callMissionTool('update_mission_criterion', { criterionId: a.criterion.id, dependsOn: [] });

    const stored = listCriteria(project, mission.id).find((r) => r.id === a.criterion.id)!;
    expect(stored.dependsOn).toEqual([]);
    expect(stored.text).toBe('A: the dependent holds');
  });

  test('update_mission_criterion rejects a dependsOn edge that closes a cycle', async () => {
    const mission = await makeMission('dependsOn cycle');
    const c = await callMissionTool('add_mission_criterion', { todoId: mission.id, text: 'C: first' });
    const d = await callMissionTool('add_mission_criterion', {
      todoId: mission.id, text: 'D: second', dependsOn: [c.criterion.id],
    });

    let message = '';
    try {
      await callMissionTool('update_mission_criterion', {
        criterionId: c.criterion.id, dependsOn: [d.criterion.id],
      });
      throw new Error('expected the cycle-closing edge to be rejected');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('criterion-dependency-cycle');

    const stored = listCriteria(project, mission.id).find((r) => r.id === c.criterion.id)!;
    expect(stored.dependsOn).toEqual([]);
  });

  test('get_mission criteria list includes dependsOn', async () => {
    const mission = await makeMission('dependsOn get_mission');
    const b = await callMissionTool('add_mission_criterion', { todoId: mission.id, text: 'B: the prerequisite holds' });
    const a = await callMissionTool('add_mission_criterion', {
      todoId: mission.id, text: 'A: the dependent holds', dependsOn: [b.criterion.id],
    });

    const got = await callMissionTool('get_mission', { todoId: mission.id });
    const row = got.criteria.find((r: any) => r.id === a.criterion.id);
    expect(row).toBeDefined();
    expect(row.dependsOn).toEqual([b.criterion.id]);
  });
});
