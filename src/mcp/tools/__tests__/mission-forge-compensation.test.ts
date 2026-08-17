import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The global supervisor DB (node_profile_override) caches its handle by MERMAID_SUPERVISOR_DIR;
// keep it STABLE (not the churned per-test project dir). Per-PROJECT stores (mission/todo/decision)
// stay fresh via the project path.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-forge-compensation-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;
let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-forge-compensation-'));
});

// Imports AFTER the env is set so any db opens against our temp dir.
import { forgeMission } from '../mission-forge';
import { getMission, _resetMissionDbCache } from '../../../services/mission-store';
import { _closeProject as closeDecisions } from '../../../services/decision-record-store';
import { _closeProject as closeTodos, listTodos } from '../../../services/todo-store';
import { _resetAsyncJobDbCache } from '../../../services/async-job-store';

afterEach(() => {
  _resetMissionDbCache(project);
  closeDecisions(project);
  closeTodos(project);
  _resetAsyncJobDbCache(project);
  rmSync(project, { recursive: true, force: true });
});

const base = () => ({
  session: 's1',
  title: 'The reviewer never over-rejects correct code',
  criteria: ['a correct null-guard leaf is accepted', 'a real defect leaf is rejected'],
});

describe('forgeMission — compensation on failure', () => {
  test('compensation removes both the mission row and the todo node when addCriterion throws', async () => {
    let call = 0;
    const addCriterion = () => {
      call += 1;
      if (call === 2) throw new Error('boom: second criterion rejected');
      return {} as any;
    };

    await expect(
      forgeMission(project, base(), { addCriterion: addCriterion as any }),
    ).rejects.toThrow(/boom/);

    const missionTodos = listTodos(project).filter((t) => t.kind === 'mission');
    expect(missionTodos).toEqual([]);
  });

  test('a failing removeTodo yields a loud rollback-INCOMPLETE error and leaves the mission row intact', async () => {
    let call = 0;
    const addCriterion = () => {
      call += 1;
      if (call === 2) throw new Error('boom: second criterion rejected');
      return {} as any;
    };
    const removeTodo = async () => {
      throw new Error('cannot remove: locked');
    };

    let capturedMissionId: string | undefined;
    try {
      await forgeMission(project, base(), { addCriterion: addCriterion as any, removeTodo: removeTodo as any });
      throw new Error('expected forgeMission to reject');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/rollback INCOMPLETE/);
      expect(msg).toMatch(/todo node/);
      expect(msg).toMatch(/boom: second criterion rejected/);
    }

    const missionTodos = listTodos(project).filter((t) => t.kind === 'mission');
    expect(missionTodos.length).toBe(1);
    capturedMissionId = missionTodos[0]!.id;
    expect(getMission(project, capturedMissionId)).toBeDefined();
  });
});
