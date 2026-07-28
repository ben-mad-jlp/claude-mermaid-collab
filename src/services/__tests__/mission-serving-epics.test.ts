// Regression test: per-criterion servingEpics threaded through collectMissionStatusFacts,
// listCriteriaWithActions, and listMissions' cheap (withFacts:false) path.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, stampEpicLandedAt, _closeProject } from '../todo-store';
import {
  upsertMission,
  addCriterion,
  listCriteriaWithActions,
  listMissions,
} from '../mission-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-serving-epics-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('per-criterion servingEpics', () => {
  test('listCriteriaWithActions and listMissions(withFacts:false) both surface serving epics with landed-ness', async () => {
    const m = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Mission: converge',
      kind: 'mission',
    });
    upsertMission(project, m.id);
    const c = addCriterion(project, m.id, 'the capability under test');
    const d = addCriterion(project, m.id, 'an unserved gap');

    const e1 = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] open serve',
      kind: 'epic',
      parentId: m.id,
      servesCriterionIds: [c.id],
    });
    const e2 = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] landed serve',
      kind: 'epic',
      parentId: m.id,
      servesCriterionIds: [c.id],
    });
    stampEpicLandedAt(project, e2.id, new Date(0).toISOString());

    const rows = listCriteriaWithActions(project, m.id);
    const critC = rows.find((r) => r.id === c.id)!;
    expect(critC.servingEpics).toContainEqual({ id: e1.id, title: e1.title, landed: false });
    expect(critC.servingEpics).toContainEqual({ id: e2.id, title: e2.title, landed: true });

    const critD = rows.find((r) => r.id === d.id)!;
    expect(critD.servingEpics).toEqual([]);

    const summaries = listMissions(project, { withFacts: false });
    const summary = summaries.find((s) => s.node.id === m.id)!;
    const cheapCritC = summary.criteria.find((r) => r.id === c.id)!;
    expect(cheapCritC.servingEpics).toContainEqual({ id: e1.id, title: e1.title, landed: false });
    expect(cheapCritC.servingEpics).toContainEqual({ id: e2.id, title: e2.title, landed: true });
  });
});
