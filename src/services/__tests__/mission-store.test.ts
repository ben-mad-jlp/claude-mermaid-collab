// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, completeTodo, sweepEpicRollups, getTodo, updateTodo, _closeProject,
} from '../todo-store';
import {
  upsertMission, getMission, deleteMission,
  addCriterion, listCriteria, setCriterionMet, removeCriterion,
  getMissionRollup, listMissions, isMissionTerminal, setMissionAbandoned, _resetMissionDbCache,
  liveRunsOf, deriveMissionStatus, deriveCriterionAction, collectMissionStatusFacts, type MissionCriterionFacts,
  CRITERION_SERVE_CAP,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import Database from 'bun:sqlite';

let project: string;

/** Directly stamp a mission control row's archivedAt (no setter exists yet). */
function archiveMissionRaw(proj: string, todoId: string) {
  const db = new Database(join(proj, '.collab', 'mission.db'));
  db.exec(`UPDATE mission SET archivedAt = ${Date.now()} WHERE todoId = '${todoId}'`);
  db.close();
  _resetMissionDbCache(proj);
}

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
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-store: control state', () => {
  test('upsertMission is idempotent', async () => {
    const id = await makeMissionNode();
    const m = upsertMission(project, id);
    expect(m.todoId).toBe(id);
    expect(m.active).toBe(true);
    // Second call returns the same row unchanged.
    const again = upsertMission(project, id);
    expect(again.todoId).toBe(id);
  });

  test('getMission is undefined before upsert', async () => {
    const id = await makeMissionNode();
    expect(getMission(project, id)).toBeUndefined();
  });

  test('getMission returns with derived status', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const m = getMission(project, id)!;
    expect(m.status).toBeDefined();
    const validStatuses = ['needs-discovery', 'needs-verify', 'blocked', 'building', 'over-budget', 'abandoned', 'converged'];
    expect(validStatuses).toContain(m.status ?? '');
  });

  test('getMission resolves a leading-8-hex short id to the same row as the full todoId', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const short = id.slice(0, 8);
    expect(getMission(project, short)).toEqual(getMission(project, id));
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
    expect(missions[0].mission.status).toBeDefined(); // status is derived
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

  test('archivedAt: default excludes an archived mission, includeArchived/onlyArchived toggle it', async () => {
    const live = (await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] live', kind: 'mission' })).id;
    upsertMission(project, live);
    const archived = (await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] archived', kind: 'mission' })).id;
    upsertMission(project, archived);
    archiveMissionRaw(project, archived);

    expect(listMissions(project).map((m) => m.node.id)).toEqual([live]);
    expect(listMissions(project, { includeArchived: true }).map((m) => m.node.id).sort()).toEqual(
      [live, archived].sort(),
    );
    expect(listMissions(project, { onlyArchived: true }).map((m) => m.node.id)).toEqual([archived]);
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
  test('sessionHasActiveMission ignores a converged/abandoned mission (does not block a new one)', async () => {
    const { sessionHasActiveMission } = await import('../mission-store');
    const a = (await createTodo(project, { ownerSession: 'design', title: '[MISSION] a', kind: 'mission' })).id;
    upsertMission(project, a);
    expect(sessionHasActiveMission(project, 'design')).toBe(true); // active + non-terminal
    setMissionAbandoned(project, a, Date.now()); // terminal
    expect(sessionHasActiveMission(project, 'design')).toBe(false); // terminal → does not count
  });

  test('abandoning a mission clears its active flag (terminal missions are never active=1)', async () => {
    const a = (await createTodo(project, { ownerSession: 'design', title: '[MISSION] a', kind: 'mission' })).id;
    upsertMission(project, a);
    expect(getMission(project, a)!.active).toBe(true);
    setMissionAbandoned(project, a, Date.now());
    expect(getMission(project, a)!.active).toBe(false); // abandon → deactivated
  });

  test('clearing abandonedAt does NOT auto-reactivate (activateMission is the way back)', async () => {
    const { activateMission } = await import('../mission-store');
    const a = (await createTodo(project, { ownerSession: 'design', title: '[MISSION] a', kind: 'mission' })).id;
    upsertMission(project, a);
    setMissionAbandoned(project, a, Date.now());
    expect(getMission(project, a)!.active).toBe(false);
    setMissionAbandoned(project, a, null); // un-abandon
    expect(getMission(project, a)!.abandonedAt).toBeNull();
    expect(getMission(project, a)!.active).toBe(false); // stays inactive — no surprise auto-activate
    activateMission(project, a);
    expect(getMission(project, a)!.active).toBe(true); // explicit re-activation works
  });

  test('converging (all criteria met) clears the active flag', async () => {
    const a = await makeMissionNode('[MISSION] converge-clears-active');
    upsertMission(project, a);
    const c = addCriterion(project, a, 'the only gap');
    expect(getMission(project, a)!.active).toBe(true);
    setCriterionMet(project, c.id, true); // last gap met → mission converges (terminal)
    expect(getMissionRollup(project, a).converged).toBe(true);
    expect(getMission(project, a)!.active).toBe(false); // converged → deactivated
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

  test('listMissions self-heals: a TERMINAL mission left active=1 is swept inactive', async () => {
    const { setMissionActive } = await import('../mission-store');
    const a = (await createTodo(project, { ownerSession: 'design', title: '[MISSION] a', kind: 'mission' })).id;
    upsertMission(project, a);
    setMissionAbandoned(project, a, Date.now()); // terminal
    setMissionActive(project, a, true);          // simulate a historical / externally-set stale active=1
    expect(getMission(project, a)!.active).toBe(true);
    listMissions(project);                        // the read-path sweep clears terminal-active rows
    expect(getMission(project, a)!.active).toBe(false);
  });
});

describe('selectConductorMission — deterministic total order (B4, replaces first-wins)', () => {
  test('picks a STABLE winner + lists the rest as rivals; two calls agree', async () => {
    const { selectConductorMission } = await import('../mission-store');
    const ids: string[] = [];
    for (const t of ['a', 'b', 'c']) {
      const id = (await createTodo(project, { ownerSession: 'design', title: `[MISSION] ${t}`, kind: 'mission' })).id;
      upsertMission(project, id);
      addCriterion(project, id, 'gap'); // needs-discovery → actionable
      ids.push(id);
    }
    const s1 = selectConductorMission(project);
    const s2 = selectConductorMission(project);
    expect(s1.target).toBeDefined();
    expect(s1.target!.node.id).toBe(s2.target!.node.id);              // deterministic across calls
    expect(s1.rivals).toHaveLength(2);                                // the other two are rivals
    expect(new Set([s1.target!.node.id, ...s1.rivals])).toEqual(new Set(ids));
  });

  test('H4 invariant: selection NEVER mutates any mission active flag', async () => {
    const { selectConductorMission } = await import('../mission-store');
    const a = (await createTodo(project, { ownerSession: 'design', title: '[MISSION] a', kind: 'mission' })).id;
    const b = (await createTodo(project, { ownerSession: 'design', title: '[MISSION] b', kind: 'mission' })).id;
    upsertMission(project, a); addCriterion(project, a, 'g');
    upsertMission(project, b); addCriterion(project, b, 'g');
    expect([getMission(project, a)!.active, getMission(project, b)!.active]).toEqual([true, true]);
    selectConductorMission(project);
    selectConductorMission(project);
    expect([getMission(project, a)!.active, getMission(project, b)!.active]).toEqual([true, true]); // untouched
  });

  test('excludes non-actionable (abandoned/terminal) missions from target AND rivals', async () => {
    const { selectConductorMission } = await import('../mission-store');
    const live = (await createTodo(project, { ownerSession: 'design', title: '[MISSION] live', kind: 'mission' })).id;
    const gone = (await createTodo(project, { ownerSession: 'design', title: '[MISSION] gone', kind: 'mission' })).id;
    upsertMission(project, live); addCriterion(project, live, 'g');
    upsertMission(project, gone); addCriterion(project, gone, 'g');
    setMissionAbandoned(project, gone, Date.now()); // terminal → excluded
    const s = selectConductorMission(project);
    expect(s.target!.node.id).toBe(live);
    expect(s.rivals).toEqual([]); // the abandoned mission is neither driven nor a rival
  });

  test('no actionable missions → no target, no rivals', async () => {
    const { selectConductorMission } = await import('../mission-store');
    expect(selectConductorMission(project)).toEqual({ rivals: [] });
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
    expect(getMission(project, id)!.status).toBeDefined();
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

describe('liveRunsOf — a landed epic\'s historical parks are not a live blocker', () => {
  test('excludes runs of DONE epics, keeps runs of in-play epics', () => {
    const epics = [
      { id: 'e-landed', status: 'done' },
      { id: 'e-open', status: 'todo' },
    ];
    const runs = [
      { epicId: 'e-landed', finalOutcome: 'blocked' }, // historical park under a since-landed epic
      { epicId: 'e-open', finalOutcome: 'pending' },    // live build under an open epic
    ];
    expect(liveRunsOf(runs, epics).map((r) => r.epicId)).toEqual(['e-open']);
  });

  test('a blocked run under a still-open epic IS live (real blocker still counts)', () => {
    const epics = [{ id: 'e1', status: 'ready' }];
    const runs = [{ epicId: 'e1', finalOutcome: 'blocked' }];
    expect(liveRunsOf(runs, epics)).toHaveLength(1);
  });

  test('a converged mission whose ONLY parks are under a done epic has no live block', () => {
    const epics = [{ id: 'e-done', status: 'done' }];
    const runs = [{ epicId: 'e-done', finalOutcome: 'rejected' }];
    expect(liveRunsOf(runs, epics)).toHaveLength(0);
  });
});

// ── Per-criterion discovery (decision mission-discovery-per-criterion) ─────────────────
// One epic building must NOT mask discovery for OTHER criteria — the conductor serves
// every open gap concurrently. Pure-function tests over deriveMissionStatus/deriveCriterionAction.

const crit = (over: Partial<MissionCriterionFacts>): MissionCriterionFacts => ({
  id: 'c', met: false, verifiedAt: null, servingEpicState: 'none', servingEpicLive: false, servedEpicCount: 0, ...over,
});
const baseFacts = {
  abandonedAt: null, budgetUsd: null, spendUsd: 0,
  hasBlockedLeaf: false, hasBuildingLeaf: false, hasLandedEpic: false, hasOpenEpic: false,
};

describe('per-criterion discovery', () => {
  test('a building epic on one criterion does NOT mask discovery on an unserved one', () => {
    expect(deriveMissionStatus({
      ...baseFacts, hasBuildingLeaf: true, hasOpenEpic: true,
      criteria: [
        crit({ id: 'c1', servingEpicState: 'open', servingEpicLive: true }),
        crit({ id: 'c2' }), // no serving epic — an open gap
      ],
    })).toBe('needs-discovery');
  });

  test('all unmet criteria served by LIVE epics → building (quiet)', () => {
    expect(deriveMissionStatus({
      ...baseFacts, hasBuildingLeaf: true, hasOpenEpic: true,
      criteria: [
        crit({ id: 'c1', servingEpicState: 'open', servingEpicLive: true }),
        crit({ id: 'c2', met: true, verifiedAt: 1 }),
      ],
    })).toBe('building');
  });

  test('a filed-but-NOT-live serving epic (unapproved / conductor-recycled) stays a discover gap', () => {
    const c = crit({ servingEpicState: 'open', servingEpicLive: false });
    expect(deriveCriterionAction(c)).toBe('discover');
    expect(deriveMissionStatus({ ...baseFacts, hasOpenEpic: true, criteria: [c] })).toBe('needs-discovery');
  });

  test('landed + verified + still unmet (verify said no) → a fresh discover gap', () => {
    expect(deriveCriterionAction(crit({ servingEpicState: 'landed', verifiedAt: 5 }))).toBe('discover');
  });

  // ── SERVE-CAP: stop re-filing an unsatisfiable criterion, escalate once ──────
  test('unmet + no live serving epic + servedEpicCount ≥ CRITERION_SERVE_CAP → escalate (not discover)', () => {
    expect(deriveCriterionAction(crit({ servedEpicCount: CRITERION_SERVE_CAP }))).toBe('escalate');
    expect(deriveCriterionAction(crit({ servedEpicCount: CRITERION_SERVE_CAP + 5 }))).toBe('escalate');
    // A landed-and-verify-said-no criterion that has burned the cap ALSO escalates (it is the
    // discover path — a fresh re-file gap — just reached via a landed serving epic).
    expect(deriveCriterionAction(crit({ servingEpicState: 'landed', verifiedAt: 5, servedEpicCount: CRITERION_SERVE_CAP }))).toBe('escalate');
  });

  test('under the cap → still discover (one fewer than the cap does NOT escalate)', () => {
    expect(deriveCriterionAction(crit({ servedEpicCount: CRITERION_SERVE_CAP - 1 }))).toBe('discover');
    expect(deriveCriterionAction(crit({ servedEpicCount: 0 }))).toBe('discover');
  });

  test('only the discover path caps: met / building / landed-unverified are NEVER flipped to escalate even over the cap', () => {
    const over = CRITERION_SERVE_CAP + 2;
    // met
    expect(deriveCriterionAction(crit({ met: true, servedEpicCount: over }))).toBe('met');
    // building (open + live serving epic)
    expect(deriveCriterionAction(crit({ servingEpicState: 'open', servingEpicLive: true, servedEpicCount: over }))).toBe('building');
    // landed-unverified still owes verify
    expect(deriveCriterionAction(crit({ met: true, servingEpicState: 'landed', servedEpicCount: over }))).toBe('verify');
    expect(deriveCriterionAction(crit({ servingEpicState: 'landed', verifiedAt: null, servedEpicCount: over }))).toBe('verify');
  });

  test('collectMissionStatusFacts.servedEpicCount counts DROPPED serving epics (the thrash history the non-dropped list misses)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mission-servecap-'));
    const prevEnv = process.env.MERMAID_SUPERVISOR_DIR;
    process.env.MERMAID_SUPERVISOR_DIR = dir;
    const proj = join(dir, 'p');
    try {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] SC', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'needs a live measurement');
      // File CRITERION_SERVE_CAP serving epics for c1, then DROP them all (the conductor's
      // per-tick re-file → drop churn). None is live/landed → servingEpicState 'none', but
      // the lifetime servedEpicCount must see all of them.
      for (let i = 0; i < CRITERION_SERVE_CAP; i++) {
        const e = await createTodo(proj, { ownerSession: 's1', title: `[EPIC] serve ${i}`, kind: 'epic', parentId: m.id, servesCriterionIds: [c1.id] });
        await updateTodo(proj, e.id, { status: 'dropped' });
      }
      const facts = collectMissionStatusFacts(proj, getMission(proj, m.id)!);
      const cf = facts.criteria.find((c) => c.id === c1.id)!;
      expect(cf.servedEpicCount).toBe(CRITERION_SERVE_CAP);
      expect(cf.servingEpicState).toBe('none'); // all dropped → no live/landed serving epic
      expect(deriveCriterionAction(cf)).toBe('escalate');
    } finally {
      _closeProject(proj);
      _resetMissionDbCache(proj);
      if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR; else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('collectMissionStatusFacts: an archived ready leaf under a live epic does not count toward hasBuildingLeaf/hasOpenEpic', async () => {
    const m = await makeMissionNode('[MISSION] archive-facts');
    upsertMission(project, m);
    const crit = addCriterion(project, m, 'does the thing');
    const e = await makeEpicChild(m, '[EPIC] build A');
    await updateTodo(project, e, { servesCriterionId: crit.id });
    await updateTodo(project, e, { status: 'ready' }); // release the epic so its child can be claimable
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'leaf under A', kind: 'leaf', parentId: e });
    await updateTodo(project, leaf.id, { status: 'ready' });

    // Before archiving: the ready leaf under a live epic makes the mission read as building.
    const before = collectMissionStatusFacts(project, getMission(project, m)!);
    expect(before.hasBuildingLeaf).toBe(true);
    expect(before.hasOpenEpic).toBe(true);

    // Archive the leaf directly (no setter exists yet) — it must vanish from the facts scan.
    const db = new Database(join(project, '.collab', 'todos.db'));
    db.exec(`UPDATE todos SET archivedAt = ${Date.now()} WHERE id = '${leaf.id}'`);
    db.close();
    _closeProject(project);

    const after = collectMissionStatusFacts(project, getMission(project, m)!);
    expect(after.hasBuildingLeaf).toBe(false);
    // The epic itself is unarchived, so it's still open — only the archived leaf is invisible.
    expect(after.hasOpenEpic).toBe(true);
  });

  test('met-but-unverified landed criterion still owes verify (verification-as-event)', () => {
    expect(deriveCriterionAction(crit({ met: true, servingEpicState: 'landed' }))).toBe('verify');
  });

  test('verify outranks discovery in the scalar headline; blocked outranks both', () => {
    const criteria = [
      crit({ id: 'c1', servingEpicState: 'landed' }), // verify
      crit({ id: 'c2' }), // discover
    ];
    expect(deriveMissionStatus({ ...baseFacts, hasLandedEpic: true, criteria })).toBe('needs-verify');
    expect(deriveMissionStatus({ ...baseFacts, hasLandedEpic: true, hasBlockedLeaf: true, criteria })).toBe('blocked');
  });

  test('rollup gaps/awaitingVerify count per-criterion actions', async () => {
    // exercised through the store: mission with 2 criteria, none served
    const dir = mkdtempSync(join(tmpdir(), 'mission-gaps-'));
    const prevEnv = process.env.MERMAID_SUPERVISOR_DIR;
    process.env.MERMAID_SUPERVISOR_DIR = dir;
    const proj = join(dir, 'p');
    try {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] G', kind: 'mission' });
      upsertMission(proj, m.id);
      addCriterion(proj, m.id, 'one');
      addCriterion(proj, m.id, 'two');
      const r = getMissionRollup(proj, m.id);
      expect(r.gaps).toBe(2);
      expect(r.awaitingVerify).toBe(0);
      expect(r.status).toBe('needs-discovery');
    } finally {
      _closeProject(proj);
      _resetMissionDbCache(proj);
      if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR; else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mission handoffDocId (constitution link)', () => {
  test('upsertMission persists handoffDocId and getMission returns it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mission-handoff-'));
    const prevEnv = process.env.MERMAID_SUPERVISOR_DIR;
    process.env.MERMAID_SUPERVISOR_DIR = dir;
    const proj = join(dir, 'p');
    try {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] H', kind: 'mission' });
      upsertMission(proj, m.id, { handoffDocId: 'handoff-some-brief' });
      expect(getMission(proj, m.id)?.handoffDocId).toBe('handoff-some-brief');
      // default null when not provided
      const m2 = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] H2', kind: 'mission' });
      upsertMission(proj, m2.id);
      expect(getMission(proj, m2.id)?.handoffDocId).toBeNull();
    } finally {
      _closeProject(proj);
      _resetMissionDbCache(proj);
      if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR; else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Multi-criterion epic edges (e7d3c02b) ─────────────────────────────────────
// Land-leaf self-heal (healMissionEpicLandLeaves / ensureMissionEpicLandLeaf) was
// retired by the land-property cutover (mission 48e1a624): landedAt is the durable
// landed signal and land leaves are no longer minted, so its test is gone. The
// caller-supplied duplicate-land-leaf guard (DuplicateLandLeafError) survives below.
import { DuplicateLandLeafError } from '../todo-store';

describe('multi-criterion epic edges', () => {
  test('one epic serving 3 criteria via servesCriterionIds makes all 3 derive building/verify', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mission-multiedge-'));
    const prevEnv = process.env.MERMAID_SUPERVISOR_DIR;
    process.env.MERMAID_SUPERVISOR_DIR = dir;
    const proj = join(dir, 'p');
    try {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] ME', kind: 'mission' });
      upsertMission(proj, m.id);
      const c1 = addCriterion(proj, m.id, 'verb works');
      const c2 = addCriterion(proj, m.id, 'verb is idempotent');
      const c3 = addCriterion(proj, m.id, 'verb fails open');
      const epic = await createTodo(proj, {
        ownerSession: 's1', title: 'import verb', kind: 'epic', parentId: m.id,
        servesCriterionIds: [c1.id, c2.id, c3.id],
      });
      // back-compat mirror: primary edge = ids[0]
      expect(epic.servesCriterionId).toBe(c1.id);
      expect(epic.servesCriterionIds).toEqual([c1.id, c2.id, c3.id]);
      const facts = collectMissionStatusFacts(proj, getMission(proj, m.id)!);
      // all 3 criteria see the SAME serving epic (open, not live yet → discover is fine;
      // the point is servingEpicState is NOT 'none' for any of them)
      for (const cf of facts.criteria) expect(cf.servingEpicState).toBe('open');
      // approval passes the guard with only the multi-edge (no explicit single edge patch)
      const approved = await updateTodo(proj, epic.id, { status: 'ready' });
      expect(approved.approvedAt).not.toBeNull();
    } finally {
      _closeProject(proj);
      _resetMissionDbCache(proj);
      if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR; else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });

});

describe('duplicate land-leaf guard', () => {
  test('creating a second live land leaf under one epic throws; after dropping the first it succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'landdupe-'));
    const prevEnv = process.env.MERMAID_SUPERVISOR_DIR;
    process.env.MERMAID_SUPERVISOR_DIR = dir;
    const proj = join(dir, 'p');
    try {
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] DG', kind: 'mission' });
      upsertMission(proj, m.id);
      const epic = await createTodo(proj, { ownerSession: 's1', title: 'an epic', kind: 'epic', parentId: m.id });
      const land1 = await createTodo(proj, { ownerSession: 's1', title: 'an epic → main', kind: 'land', parentId: epic.id, assigneeKind: 'human' });
      await expect(
        createTodo(proj, { ownerSession: 's1', title: 'an epic → main (dupe)', kind: 'land', parentId: epic.id, assigneeKind: 'human' }),
      ).rejects.toThrow(DuplicateLandLeafError);
      // dropping the live one re-opens the slot
      await updateTodo(proj, land1.id, { status: 'dropped' });
      const land2 = await createTodo(proj, { ownerSession: 's1', title: 'an epic → main', kind: 'land', parentId: epic.id, assigneeKind: 'human' });
      expect(land2.kind).toBe('land');
    } finally {
      _closeProject(proj);
      _resetMissionDbCache(proj);
      if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR; else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
