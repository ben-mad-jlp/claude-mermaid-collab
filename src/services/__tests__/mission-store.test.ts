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
  stampDiscover, stampVerify, deleteMission,
  addCriterion, listCriteria, setCriterionMet, removeCriterion,
  getMissionRollup, listMissions, MISSION_CYCLE, _resetMissionDbCache,
} from '../mission-store';
import type { MissionPhase } from '../mission-store';

let project: string;

/** Create the `[MISSION]` graph node (a top-level durable root). Explicit kind
 *  (decision e852fb0c, stage C) — the title prefix no longer decides role. */
async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}
/** Create a child under a parent + return its id. Defaults to an `[EPIC]` child,
 *  but a caller passing a plain (non-bracketed) title means a leaf. Explicit kind
 *  (decision e852fb0c, stage C) — the title prefix no longer decides role. */
async function makeEpicChild(parentId: string, title = '[EPIC] iter epic') {
  const kind = title.trim().startsWith('[EPIC]') ? 'epic' : 'leaf';
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, parentId, kind });
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
  test('upsertMission is idempotent and starts at discover/iteration 1', async () => {
    const id = await makeMissionNode();
    const m = upsertMission(project, id);
    expect(m.phase).toBe('discover');
    expect(m.iteration).toBe(1);
    expect(m.lastDiscoverAt).toBeNull();
    expect(m.maxIterations).toBeNull();
    // Second call returns the same row unchanged (does not reset phase).
    setMissionPhase(project, id, 'plan');
    const again = upsertMission(project, id);
    expect(again.phase).toBe('plan');
  });

  test('upsertMission accepts loop-spec config (maxIterations + procedure)', async () => {
    const id = await makeMissionNode();
    const m = upsertMission(project, id, { maxIterations: 8, procedure: 'run tests, fix worst' });
    expect(m.maxIterations).toBe(8);
    expect(m.procedure).toBe('run tests, fix worst');
  });

  test('getMission is undefined before upsert', async () => {
    const id = await makeMissionNode();
    expect(getMission(project, id)).toBeUndefined();
  });

  test('nextPhase walks discover→plan→execute→verify→discover; terminals stay put', () => {
    expect(nextPhase('discover')).toBe('plan');
    expect(nextPhase('plan')).toBe('execute');
    expect(nextPhase('execute')).toBe('verify');
    expect(nextPhase('verify')).toBe('discover');
    expect(nextPhase('converged')).toBe('converged');
    expect(nextPhase('stopped')).toBe('stopped');
    expect(MISSION_CYCLE).toEqual(['discover', 'plan', 'execute', 'verify']);
  });

  test('advanceMission cycles discover→plan→execute→verify (same iteration)', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const expectedPhases: MissionPhase[] = ['plan', 'execute', 'verify'];
    for (const expected of expectedPhases) {
      const m = advanceMission(project, id);
      expect(m.phase).toBe(expected);
      expect(m.iteration).toBe(1);
    }
  });

  test('VERIFY with no convergence + no cap loops back to discover, iteration++', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    addCriterion(project, id, 'unmet'); // exists but not met → not converged
    setMissionPhase(project, id, 'verify');
    const m = advanceMission(project, id);
    expect(m.phase).toBe('discover');
    expect(m.iteration).toBe(2);
    expect(m.stopReason).toBeNull();
  });

  test('VERIFY converges when all criteria met', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c = addCriterion(project, id, 'done');
    setCriterionMet(project, c.id, true);
    setMissionPhase(project, id, 'verify');
    const m = advanceMission(project, id);
    expect(m.phase).toBe('converged');
    expect(m.stopReason).toBe('converged');
  });

  test('STOP-WHEN: VERIFY at maxIterations (un-converged) → stopped', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id, { maxIterations: 2 });
    addCriterion(project, id, 'never-met'); // present, unmet → cannot converge
    // Iteration 1 verify: 1 < 2 → loops back to discover, iteration 2.
    setMissionPhase(project, id, 'verify');
    expect(advanceMission(project, id).iteration).toBe(2);
    // Iteration 2 verify: 2 >= 2 → STOP.
    setMissionPhase(project, id, 'verify');
    const m = advanceMission(project, id);
    expect(m.phase).toBe('stopped');
    expect(m.stopReason).toBe('max-iterations');
    // Terminal: further advance is a no-op.
    expect(advanceMission(project, id).phase).toBe('stopped');
  });

  test('advanceMission is a no-op once terminal', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    setMissionPhase(project, id, 'converged');
    expect(advanceMission(project, id).phase).toBe('converged');
  });

  test('stampDiscover / stampVerify record timestamps', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    expect(stampDiscover(project, id).lastDiscoverAt).not.toBeNull();
    expect(stampVerify(project, id).lastVerifyAt).not.toBeNull();
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

  test('setCriterionVerdict records met + evidence + verifiedBy (independent-judge audit trail)', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c = addCriterion(project, id, 'canvas opens');
    expect(c.evidence).toBeNull();
    const { setCriterionVerdict } = await import('../mission-store');
    setCriterionVerdict(project, c.id, { met: true, evidence: 'clicked New → canvas rendered (screenshot)', verifiedBy: 'reviewer-agent-1' });
    const got = listCriteria(project, id)[0];
    expect(got.met).toBe(true);
    expect(got.evidence).toContain('canvas rendered');
    expect(got.verifiedBy).toBe('reviewer-agent-1');
    expect(got.verifiedAt).not.toBeNull();
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
    // a plain epic root → not a mission (explicit kind, decision e852fb0c stage C)
    // missionId:null = the explicit opt-out (todo-store.ts:816). Without it, §4d homes a
    // deliverable epic under the owner session's active mission — so this "root" epic became
    // a CHILD of m1 and showed up in missions[0].epics.
    await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] not a mission', kind: 'epic', missionId: null });

    const missions = listMissions(project);
    expect(missions).toHaveLength(1);
    expect(missions[0].node.id).toBe(m1);
    expect(missions[0].node.title).toBe('[MISSION] one');
    expect(missions[0].mission.phase).toBe('discover');
    expect(missions[0].rollup.capability).toEqual({ met: 0, total: 1 });
    expect(missions[0].criteria).toHaveLength(1);
    expect(missions[0].ownerSession).toBe('s1'); // mission↔session tie
    expect(missions[0].epics).toEqual([]); // no epic children yet
  });

  test('includes the mission epic children (the MECHANICAL items)', async () => {
    const m = await makeMissionNode('[MISSION] with epics');
    upsertMission(project, m);
    await makeEpicChild(m, '[EPIC] build A');
    await makeEpicChild(m, '[EPIC] build B');
    const s = listMissions(project)[0];
    expect(s.epics.map((e) => e.title).sort()).toEqual(['[EPIC] build A', '[EPIC] build B']);
    expect(s.rollup.mechanical.total).toBe(2);
  });

  test('session filter returns only missions owned by that session', async () => {
    const a = (await createTodo(project, { allowOrphan: true, ownerSession: 'alpha', title: '[MISSION] a', kind: 'mission' })).id;
    upsertMission(project, a);
    const b = (await createTodo(project, { allowOrphan: true, ownerSession: 'beta', title: '[MISSION] b', kind: 'mission' })).id;
    upsertMission(project, b);
    expect(listMissions(project).length).toBe(2);
    expect(listMissions(project, { session: 'alpha' }).map((m) => m.node.id)).toEqual([a]);
    expect(listMissions(project, { session: 'beta' }).map((m) => m.node.id)).toEqual([b]);
    expect(listMissions(project, { session: 'nobody' })).toEqual([]);
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

describe('active mission (one per session)', () => {
  test('activateMission activates one + deactivates same-session siblings only', async () => {
    const { activateMission, setMissionActive, sessionHasActiveMission } = await import('../mission-store');
    // two missions owned by 'design', one by 'other'
    const a = (await createTodo(project, { ownerSession: 'design', assigneeSession: 'design', title: '[MISSION] a', kind: 'mission' })).id;
    const b = (await createTodo(project, { ownerSession: 'design', assigneeSession: 'design', title: '[MISSION] b', kind: 'mission' })).id;
    const c = (await createTodo(project, { ownerSession: 'other', assigneeSession: 'other', title: '[MISSION] c', kind: 'mission' })).id;
    upsertMission(project, a); upsertMission(project, b); upsertMission(project, c);
    // all default active
    expect(getMission(project, a)!.active).toBe(true);

    const deactivated = activateMission(project, a);
    expect(deactivated).toEqual([b]);                 // only the same-session sibling
    expect(getMission(project, a)!.active).toBe(true);
    expect(getMission(project, b)!.active).toBe(false);
    expect(getMission(project, c)!.active).toBe(true); // other session untouched
    expect(sessionHasActiveMission(project, 'design')).toBe(true);
    expect(sessionHasActiveMission(project, 'design', a)).toBe(false); // a is the only design-active

    // switch active to b
    expect(activateMission(project, b)).toEqual([a]);
    expect(getMission(project, a)!.active).toBe(false);
    expect(getMission(project, b)!.active).toBe(true);
    setMissionActive(project, a, true); // low-level still works
    expect(getMission(project, a)!.active).toBe(true);
  });
});

describe('mission meta-fixes', () => {
  test('sessionHasActiveMission ignores a converged/terminal mission (does not block a new one)', async () => {
    const { sessionHasActiveMission, setMissionPhase } = await import('../mission-store');
    const a = (await createTodo(project, { ownerSession: 'design', title: '[MISSION] a', kind: 'mission' })).id;
    upsertMission(project, a);
    expect(sessionHasActiveMission(project, 'design')).toBe(true); // active + non-terminal
    setMissionPhase(project, a, 'converged'); // terminal, still active=1
    expect(sessionHasActiveMission(project, 'design')).toBe(false); // terminal → does not count
  });

  test('listMissions self-heals: an orphan mission row (node dropped) is pruned', async () => {
    const { removeTodo } = await import('../todo-store');
    const id = await makeMissionNode('[MISSION] soon-gone');
    upsertMission(project, id);
    addCriterion(project, id, 'c');
    expect(getMission(project, id)).toBeDefined();
    // Drop the node out of the graph (simulating a node-drop that skips delete_mission).
    await removeTodo(project, id);
    // listMissions should prune the now-orphaned mission + criterion rows.
    expect(listMissions(project)).toEqual([]);
    expect(getMission(project, id)).toBeUndefined(); // control row pruned
    expect(listCriteria(project, id)).toHaveLength(0);
  });
});

describe('updateCriterionText', () => {
  test('edits a criterion text without changing its verdict', async () => {
    const { updateCriterionText, setCriterionVerdict } = await import('../mission-store');
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c = addCriterion(project, id, 'old text');
    setCriterionVerdict(project, c.id, { met: true, evidence: 'e' });
    updateCriterionText(project, c.id, 'new text');
    const got = listCriteria(project, id)[0];
    expect(got.text).toBe('new text');
    expect(got.met).toBe(true); // verdict preserved
    expect(got.evidence).toBe('e');
  });
});

describe('reassignOwnerSession (set_mission_owner backing)', () => {
  test('re-homes a mission node to a new session (owner + assignee)', async () => {
    const { reassignOwnerSession } = await import('../todo-store');
    const id = (await createTodo(project, { ownerSession: 'yolox-local', assigneeSession: 'yolox-local', title: '[MISSION] m', kind: 'mission' })).id;
    upsertMission(project, id);
    addCriterion(project, id, 'keep me');
    const updated = await reassignOwnerSession(project, id, 'design');
    expect(updated.ownerSession).toBe('design');
    expect(updated.assigneeSession).toBe('design');
    // mission state preserved (criteria untouched by the re-home).
    expect(listCriteria(project, id).map((c) => c.text)).toEqual(['keep me']);
    expect(getMission(project, id)!.phase).toBe('discover');
  });
});

describe('[MISSION] is a legitimate top-level root', () => {
  test('a [MISSION] title creates parentless WITHOUT allowOrphan/inbox (resolveTodoParent exemption)', async () => {
    // A plain non-epic top-level create throws OrphanTodoError; a [MISSION] must not.
    const t = await createTodo(project, { ownerSession: 's1', title: '[MISSION] converge X', kind: 'mission' });
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
    const epicId = (await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[EPIC] normal', kind: 'epic' })).id;
    const child = await makeEpicChild(epicId, 'child leaf');
    const res = await completeTodo(project, child, 'accepted');
    expect(res.rolledUp).toContain(epicId);
    expect(getTodo(project, epicId)!.status).toBe('done');
  });
});
