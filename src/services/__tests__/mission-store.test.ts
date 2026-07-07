// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, completeTodo, sweepEpicRollups, getTodo, _closeProject,
} from '../todo-store';
import {
  upsertMission, getMission, setMissionPhase, advanceMission, nextPhase,
  stampDogfood, stampAssess, deleteMission,
  addCriterion, listCriteria, setCriterionMet, removeCriterion,
  getMissionRollup, listMissions, MISSION_CYCLE, _resetMissionDbCache,
} from '../mission-store';
import type { MissionPhase } from '../mission-store';

let project: string;

/** Create the `[MISSION]` graph node (a top-level durable root). */
async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title });
  return t.id;
}
/** Create an `[EPIC]` child under a parent + return its id. */
async function makeEpicChild(parentId: string, title = '[EPIC] iter epic') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, parentId });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-store-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-store: control state', () => {
  test('upsertMission is idempotent and starts at dogfood/iteration 1', async () => {
    const id = await makeMissionNode();
    const m = upsertMission(project, id);
    expect(m.phase).toBe('dogfood');
    expect(m.iteration).toBe(1);
    expect(m.lastDogfoodAt).toBeNull();
    // Second call returns the same row unchanged (does not reset phase).
    setMissionPhase(project, id, 'plan');
    const again = upsertMission(project, id);
    expect(again.phase).toBe('plan');
  });

  test('getMission is undefined before upsert', async () => {
    const id = await makeMissionNode();
    expect(getMission(project, id)).toBeUndefined();
  });

  test('nextPhase walks the cycle and wraps assess → dogfood; converged is terminal', () => {
    expect(nextPhase('dogfood')).toBe('find_gap');
    expect(nextPhase('assess')).toBe('dogfood');
    expect(nextPhase('converged')).toBe('converged');
    // full lap
    let p = MISSION_CYCLE[0];
    for (let i = 0; i < MISSION_CYCLE.length; i++) p = nextPhase(p);
    expect(p).toBe('dogfood');
  });

  test('advanceMission cycles phases and bumps iteration only on the assess→dogfood wrap', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    // dogfood → find_gap → plan → steward → land → assess : same iteration
    const expectedPhases: MissionPhase[] = ['find_gap', 'plan', 'steward', 'land', 'assess'];
    for (const expected of expectedPhases) {
      const m = advanceMission(project, id);
      expect(m.phase).toBe(expected);
      expect(m.iteration).toBe(1);
    }
    // assess → dogfood : new lap
    const wrapped = advanceMission(project, id);
    expect(wrapped.phase).toBe('dogfood');
    expect(wrapped.iteration).toBe(2);
  });

  test('advanceMission is a no-op once converged', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    setMissionPhase(project, id, 'converged');
    const m = advanceMission(project, id);
    expect(m.phase).toBe('converged');
  });

  test('stampDogfood / stampAssess record timestamps', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    expect(stampDogfood(project, id).lastDogfoodAt).not.toBeNull();
    expect(stampAssess(project, id).lastAssessAt).not.toBeNull();
  });

  test('deleteMission removes control state + criteria', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    addCriterion(project, id, 'a');
    deleteMission(project, id);
    expect(getMission(project, id)).toBeUndefined();
    expect(listCriteria(project, id)).toHaveLength(0);
  });
});

describe('mission-store: criteria', () => {
  test('add / list / setMet / remove', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c1 = addCriterion(project, id, 'can create an assembly');
    const c2 = addCriterion(project, id, 'can simulate physics');
    expect(listCriteria(project, id).map((c) => c.text)).toEqual([
      'can create an assembly', 'can simulate physics',
    ]);
    expect(c1.met).toBe(false);
    setCriterionMet(project, c1.id, true);
    expect(listCriteria(project, id).find((c) => c.id === c1.id)!.met).toBe(true);
    removeCriterion(project, c2.id);
    expect(listCriteria(project, id)).toHaveLength(1);
  });

  test('empty criterion text throws; unknown ids throw / no-op appropriately', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    expect(() => addCriterion(project, id, '   ')).toThrow();
    expect(() => setCriterionMet(project, 'nope', true)).toThrow();
  });
});

describe('mission-store: listMissions', () => {
  test('lists only [MISSION] roots that have control state, with node+rollup+criteria', async () => {
    const m1 = await makeMissionNode('[MISSION] one');
    upsertMission(project, m1);
    addCriterion(project, m1, 'c1');
    // a [MISSION]-titled node WITHOUT upsertMission → skipped (not a real mission)
    await makeMissionNode('[MISSION] two (no control state)');
    // a plain epic root → not a mission
    await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] not a mission' });

    const missions = listMissions(project);
    expect(missions).toHaveLength(1);
    expect(missions[0].node.id).toBe(m1);
    expect(missions[0].node.title).toBe('[MISSION] one');
    expect(missions[0].mission.phase).toBe('dogfood');
    expect(missions[0].rollup.capability).toEqual({ met: 0, total: 1 });
    expect(missions[0].criteria).toHaveLength(1);
  });

  test('empty when no missions', () => {
    expect(listMissions(project)).toEqual([]);
  });
});

describe('mission-store: convergence rollup', () => {
  test('mechanical counts [EPIC] children done/total; capability counts criteria met/total', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const e1 = await makeEpicChild(id);
    await makeEpicChild(id);
    const c1 = addCriterion(project, id, 'crit A');
    addCriterion(project, id, 'crit B');

    let r = getMissionRollup(project, id);
    expect(r.mechanical).toEqual({ done: 0, total: 2 });
    expect(r.capability).toEqual({ met: 0, total: 2 });
    expect(r.converged).toBe(false);

    await completeTodo(project, e1, 'accepted');
    setCriterionMet(project, c1.id, true);
    r = getMissionRollup(project, id);
    expect(r.mechanical.done).toBe(1);
    expect(r.capability.met).toBe(1);
    expect(r.converged).toBe(false); // one criterion still unmet
  });

  test('converged is true iff ≥1 criterion and all met', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    expect(getMissionRollup(project, id).converged).toBe(false); // no criteria
    const c = addCriterion(project, id, 'only crit');
    setCriterionMet(project, c.id, true);
    expect(getMissionRollup(project, id).converged).toBe(true);
  });
});

describe('[MISSION] is a legitimate top-level root', () => {
  test('a [MISSION] title creates parentless WITHOUT allowOrphan/inbox (resolveTodoParent exemption)', async () => {
    // A plain non-epic top-level create throws OrphanTodoError; a [MISSION] must not.
    const t = await createTodo(project, { ownerSession: 's1', title: '[MISSION] converge X' });
    expect(t.parentId).toBeNull();
    expect(getTodo(project, t.id)!.title).toBe('[MISSION] converge X');
  });

  test('a plain non-epic top-level create still throws (proves the exemption is scoped)', async () => {
    await expect(createTodo(project, { ownerSession: 's1', title: 'just a floating todo' })).rejects.toThrow();
  });
});

describe('[MISSION] node is a durable non-closing root', () => {
  test('completeTodo event-path does NOT roll up a [MISSION] parent when all its epics complete', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    const e1 = await makeEpicChild(missionId);
    const e2 = await makeEpicChild(missionId);
    await completeTodo(project, e1, 'accepted');
    const res = await completeTodo(project, e2, 'accepted'); // last child settles
    // A plain [EPIC] would appear in rolledUp here; the mission must NOT.
    expect(res.rolledUp).not.toContain(missionId);
    expect(getTodo(project, missionId)!.status).not.toBe('done');
  });

  test('sweepEpicRollups does NOT close a [MISSION] with all children done', async () => {
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);
    const e1 = await makeEpicChild(missionId);
    await completeTodo(project, e1, 'accepted');
    const { rolledUp } = await sweepEpicRollups(project);
    expect(rolledUp).not.toContain(missionId);
    expect(getTodo(project, missionId)!.status).not.toBe('done');
  });

  test('CONTROL: a plain [EPIC] parent DOES roll up when all children complete (proves the exemption is mission-specific)', async () => {
    // A normal epic with a completed child rolls up via the event-path.
    const epicId = (await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] normal' })).id;
    const child = await makeEpicChild(epicId, 'child leaf');
    const res = await completeTodo(project, child, 'accepted');
    expect(res.rolledUp).toContain(epicId);
    expect(getTodo(project, epicId)!.status).toBe('done');
  });
});
