// The non-forge bypass: create_mission / add_mission_criterion must reject
// forward-accrual criterion text via the existing detectForwardAccrual gate,
// while leaving one-shot criteria unaffected.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMissionTool } from '../mission-tools';
import { _closeProject } from '../../services/todo-store';
import { listMissions, listCriteria } from '../../services/mission-store';
import { _closeDb } from '../../services/supervisor-store';

let project: string;
const S = 's_test';

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-criterion-closeability-gate-'));
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

describe('mission criterion closeability gate', () => {
  test('create_mission rejects a forward-accrual criterion and creates no mission row', async () => {
    await expect(
      handleMissionTool('create_mission', {
        project,
        session: S,
        title: 'T',
        criteria: ['ok one', 'holds over ≥5 live mission passes'],
      }),
    ).rejects.toThrow(/forward-accrual criterion/);

    expect(listMissions(project, {}).length).toBe(0);
  });

  test('add_mission_criterion rejects forward-accrual text and leaves listCriteria unchanged', async () => {
    const created = await callMissionTool('create_mission', {
      session: S,
      title: 'Clean mission',
      criteria: ['grep -c fooBar src/ returns 3 matches'],
    });
    const missionId = created.node.id;
    const before = listCriteria(project, missionId).length;

    await expect(
      callMissionTool('add_mission_criterion', {
        todoId: missionId,
        text: 'continues to hold going forward',
      }),
    ).rejects.toThrow(/forward-accrual criterion/);

    expect(listCriteria(project, missionId).length).toBe(before);
  });

  test('a one-shot criterion still succeeds on both create_mission and add_mission_criterion', async () => {
    const created = await callMissionTool('create_mission', {
      session: S,
      title: 'One-shot mission',
      criteria: ['grep -c fooBar src/ returns 3 matches'],
    });
    expect(created.criteria.length).toBe(1);

    const added = await callMissionTool('add_mission_criterion', {
      todoId: created.node.id,
      text: 'npx tsc --noEmit produces typecheck-report.json with an errorCount of 0',
    });
    expect(added.criterion.text).toBe('npx tsc --noEmit produces typecheck-report.json with an errorCount of 0');
  });
});
