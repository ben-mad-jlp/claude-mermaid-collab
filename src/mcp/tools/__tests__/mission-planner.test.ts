import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-planner-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { planMissionCriterion, parseEpicSpec, buildPlannerPrompt, extractBalancedJsonObject, ServeIntegrityError } from '../mission-planner';
import { forgeMission } from '../mission-forge';
import { listCriteria, listCriteriaWithActions, CHILDLESS_SERVE_GRACE_MS, _resetMissionDbCache } from '../../../services/mission-store';
import { getTodo, listTodos, deriveTodoViews, updateTodo, _closeProject as closeTodos, type Todo } from '../../../services/todo-store';
import { _closeProject as closeDecisions } from '../../../services/decision-record-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'mission-planner-')); _resetMissionDbCache(project); });
afterEach(() => { _resetMissionDbCache(project); closeTodos(project); closeDecisions(project); rmSync(project, { recursive: true, force: true }); });

const EPIC_SPEC = {
  title: 'Harden the review-gate falsifiability heuristic',
  description: 'Make the doubt classifier clause-aware.',
  leaves: [
    { title: 'clause-split the doubt classifier', description: 'edit isNonFalsifiableReviewDoubt in leaf-executor.ts', files: ['src/services/leaf-executor.ts'] },
    { title: 'add regression tests', description: 'encode the mixed-finding cases', files: ['src/services/__tests__/leaf-executor.test.ts'], dependsOn: ['$0'] },
  ],
};
const mockInvoke = (spec: unknown = EPIC_SPEC) => async () => ({ ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(spec) + '\n```' } as any);

async function approvedMission() {
  const forged = await forgeMission(project, { session: 's1', title: 'The reviewer never over-rejects', criteria: ['doubt over a green gate abstains', 'a real defect still gates'] });
  const crits = listCriteria(project, forged.missionId);
  return { missionId: forged.missionId, criterionId: crits[0].id, secondId: crits[1].id };
}

describe('planMissionCriterion — planner node → epic + leaves, ready', () => {
  test('creates a mission-homed epic serving the criteria, with READY leaves', async () => {
    const { missionId, criterionId } = await approvedMission();
    const r = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke() });

    // Epic homed under the mission, serving the criterion.
    const epic = getTodo(project, r.epicId);
    expect(epic?.kind).toBe('epic');
    expect(epic?.parentId).toBe(missionId);
    expect(epic?.servesCriterionIds ?? []).toContain(criterionId);
    expect(r.modelUsed).toBe('opus');

    // Two work leaves created under the epic, promoted to READY (claimable by the daemon).
    expect(r.leafIds).toHaveLength(2);
    const views = deriveTodoViews(project, listTodos(project, { includeCompleted: true }));
    const leaves = views.filter((t) => r.leafIds.includes(t.id));
    expect(leaves.every((l) => l.parentId === r.epicId)).toBe(true);
    expect(leaves.every((l) => l.derivedStatus === 'ready' || l.derivedStatus === 'blocked')).toBe(true); // 2nd is dep-blocked until 1st
    // the second leaf depends on the first.
    const second = views.find((t) => t.id === r.leafIds[1]);
    expect(second?.dependsOn).toContain(r.leafIds[0]);
  });

  test('cross-project mission: epic + leaves inherit the mission node targetProject', async () => {
    const { missionId, criterionId } = await approvedMission();
    const target = '/tmp/some-other-implementation-repo';
    await updateTodo(project, missionId, { targetProject: target });

    const r = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke() });

    const epic = getTodo(project, r.epicId);
    expect(epic?.targetProject).toBe(target);
    for (const leafId of r.leafIds) {
      expect(getTodo(project, leafId)?.targetProject).toBe(target);
    }
  });

  test('same-project mission: serves keep the default (no targetProject stamp)', async () => {
    const { missionId, criterionId } = await approvedMission();
    const r = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke() });
    const epic = getTodo(project, r.epicId);
    expect(epic?.targetProject === null || epic?.targetProject === project || epic?.targetProject === undefined).toBe(true);
  });

  test('one epic can serve several criteria', async () => {
    const { missionId, criterionId, secondId } = await approvedMission();
    const r = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId, secondId] }, { invoke: mockInvoke() });
    const epic = getTodo(project, r.epicId);
    expect(epic?.servesCriterionIds ?? []).toEqual(expect.arrayContaining([criterionId, secondId]));
  });

  test('a planner node with no parseable spec throws (nothing created)', async () => {
    const { missionId, criterionId } = await approvedMission();
    await expect(
      planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, {
        invoke: async () => ({ ok: true, rateLimited: false, text: 'I could not plan it' } as any),
      }),
    ).rejects.toThrow(/no (parseable epic-spec JSON|complete JSON object)/i);
  });

  test('parseEpicSpec: a `}` inside a string value does NOT truncate (the Unterminated-string bug)', async () => {
    // A leaf description containing a literal `}` used to break the naive lastIndexOf('}') slice.
    const spec = { title: 'T', leaves: [{ title: 'L', description: 'call foo() { return x } here' }] };
    const parsed = parseEpicSpec('```json\n' + JSON.stringify(spec) + '\n```');
    expect(parsed.title).toBe('T');
    expect(parsed.leaves[0].description).toContain('{ return x }');
  });

  test('extractBalancedJsonObject: returns null on a truncated/unbalanced emission', () => {
    expect(extractBalancedJsonObject('{"a":"has } a brace","b":1}')).toBe('{"a":"has } a brace","b":1}');
    expect(extractBalancedJsonObject('{"title":"T","leaves":[{"title":"unclosed')).toBeNull();
    expect(extractBalancedJsonObject('no json here')).toBeNull();
  });

  test('planner unparseable on attempt 1 → repair-retry succeeds on attempt 2 (no serve failure)', async () => {
    const { missionId, criterionId } = await approvedMission();
    let n = 0;
    const invoke = async () => {
      n++;
      return n === 1
        ? { ok: true, rateLimited: false, text: 'here is the plan: {"title":"T","leaves":[{"title":"unclosed' } as any
        : { ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(EPIC_SPEC) + '\n```' } as any;
    };
    const r = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke });
    expect(n).toBe(2); // retried exactly once
    expect(r.leafIds).toHaveLength(2); // recovered — the serve did NOT fail
  });

  test('unknown criterionIds throw before spawning', async () => {
    const { missionId } = await approvedMission();
    let invoked = 0;
    await expect(
      planMissionCriterion(project, { session: 's1', missionId, criterionIds: ['nope'] }, { invoke: async () => { invoked++; return {} as any; } }),
    ).rejects.toThrow(/none of the criterionIds match/i);
    expect(invoked).toBe(0);
  });

  test('non-discover action refuses with ServeIntegrityError, no epic created', async () => {
    const { missionId, criterionId } = await approvedMission();
    let invoked = 0;

    // Create and plan an epic to serve the criterion — this creates a serving epic
    const r1 = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke() });
    expect(r1.leafIds.length).toBeGreaterThan(0);

    // Now try to plan the same criterion again while it's being served (action should be 'building')
    await expect(
      planMissionCriterion(
        project,
        { session: 's1', missionId, criterionIds: [criterionId] },
        {
          invoke: async () => { invoked++; return {} as any; },
        },
      ),
    ).rejects.toThrow(/serve-integrity|already being served/i);

    // No second epic should have been created (invoke never called)
    expect(invoked).toBe(0);

    // Mission should have exactly one epic (from the first plan)
    const todos = listTodos(project, { includeCompleted: true });
    const epics = todos.filter((t) => t.kind === 'epic' && t.parentId === missionId);
    expect(epics.length).toBe(1);
  });

  test('second planMissionCriterion throws ServeIntegrityError naming the live serving epic', async () => {
    const { missionId, criterionId } = await approvedMission();
    let invokeCount = 0;

    // First call: plan an epic to serve the criterion.
    const r1 = await planMissionCriterion(
      project,
      { session: 's1', missionId, criterionIds: [criterionId] },
      { invoke: mockInvoke() },
    );
    const epicTitle = getTodo(project, r1.epicId)!.title;

    // Second call: try to plan the same criterion again — should throw ServeIntegrityError.
    try {
      await planMissionCriterion(
        project,
        { session: 's1', missionId, criterionIds: [criterionId] },
        {
          invoke: async () => { invokeCount++; return {} as any; },
        },
      );
      throw new Error('Expected ServeIntegrityError to be thrown');
    } catch (e) {
      if (!(e instanceof ServeIntegrityError)) throw e;
      expect(e.criterionId).toBe(criterionId);
      expect(e.servingEpicId).toBe(r1.epicId);
      expect(e.servingEpicTitle).toBe(epicTitle);
      expect(e.servingEpicState).toBe('open');
      expect(e.message).toContain(r1.epicId.slice(0, 8));
    }

    // Invoke should not have been called.
    expect(invokeCount).toBe(0);
  });

  // Deferred gate: lets a test hold the planner-node invocation open (in-flight) and settle it
  // at a chosen moment — the trick for exercising the inFlightServes reservation mid-call.
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  const NODE_OK = { ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(EPIC_SPEC) + '\n```' } as any;

  test('client abandons the await mid-call: the detached serve still completes and is visible on a fresh read', async () => {
    const { missionId, criterionId } = await approvedMission();
    const gate = deferred<any>();
    let invoked = 0;
    let serveErr: unknown;

    // The "client" fires the call and walks away from the await (simulating an MCP-boundary
    // timeout). The promise is deliberately NOT awaited — only the store is consulted below.
    planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, {
      invoke: async () => { invoked++; return gate.promise; },
    }).catch((e) => { serveErr = e; });

    // The planner node finishes AFTER the client abandoned the call.
    gate.resolve(NODE_OK);

    // Fresh store reads until the serve lands (or times out).
    const deadline = Date.now() + 2_000;
    let epic: Todo | undefined;
    while (Date.now() < deadline && !serveErr) {
      epic = listTodos(project, { includeCompleted: true }).find(
        (t) => t.kind === 'epic' && t.parentId === missionId && t.status !== 'dropped'
          && (t.servesCriterionIds ?? []).includes(criterionId),
      );
      if (epic?.approvedAt) break; // status:'ready' = approve; it stamps approvedAt (status stays derived)
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(serveErr).toBeUndefined();
    expect(epic).toBeDefined();
    expect(epic!.approvedAt).toBeTruthy(); // approved for the daemon despite the client never awaiting
    const leaves = listTodos(project, { includeCompleted: true })
      .filter((t) => t.kind === 'leaf' && t.parentId === epic!.id);
    const titles = leaves.map((l) => l.title);
    for (const planned of EPIC_SPEC.leaves) expect(titles).toContain(planned.title);
    expect(invoked).toBe(1);
  });

  test('concurrent second call for the same criterion piggybacks on the in-flight serve (no double-create)', async () => {
    const { missionId, criterionId } = await approvedMission();
    const gate = deferred<any>();
    let invoked1 = 0;
    let invoked2 = 0;

    // Call 1: gated in-flight on the deferred planner node.
    const p1 = planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, {
      invoke: async () => { invoked1++; return gate.promise; },
    });
    // Call 2 arrives for the SAME criterion while call 1 is still unresolved.
    const p2 = planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, {
      invoke: async () => { invoked2++; return NODE_OK; },
    });

    // While call 1 is still in-flight, NOTHING has been created — call 2 did not double-create.
    const midFlight = listTodos(project, { includeCompleted: true })
      .filter((t) => t.kind === 'epic' && t.parentId === missionId);
    expect(midFlight).toHaveLength(0);

    gate.resolve(NODE_OK);
    const [r1, r2] = await Promise.all([p1, p2]);

    // Both calls resolved to the SAME serve; the second never spawned its own planner node.
    expect(r2.epicId).toBe(r1.epicId);
    expect(invoked1).toBe(1);
    expect(invoked2).toBe(0);

    // Exactly ONE epic exists for the criterion afterward.
    const epics = listTodos(project, { includeCompleted: true })
      .filter((t) => t.kind === 'epic' && t.parentId === missionId);
    expect(epics).toHaveLength(1);
    expect(epics[0].id).toBe(r1.epicId);
  });

  test('mid-call instantiation failure while the client abandoned leaves NOTHING live (epic dropped atomically)', async () => {
    const { missionId, criterionId } = await approvedMission();
    // Leaf 2 references "$5" (out of range), so addLeavesToEpic throws AFTER the epic and the
    // first leaf already exist — exercising the atomic drop-on-failure arm.
    const badSpec = { title: 'partial epic', leaves: [{ title: 'ok leaf' }, { title: 'bad leaf', dependsOn: ['$5'] }] };
    const gate = deferred<any>();

    const p = planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, {
      invoke: async () => gate.promise,
    });
    p.catch(() => {}); // the client walked away — settlement is only observed via the store + a fresh call

    gate.resolve({ ok: true, rateLimited: false, text: JSON.stringify(badSpec) } as any);
    await expect(p).rejects.toThrow(/out of range/i);

    // Nothing LIVE for the criterion: the partially-instantiated epic was dropped, not left half-made.
    const live = listTodos(project, { includeCompleted: true })
      .filter((t) => t.kind === 'epic' && t.parentId === missionId && t.status !== 'dropped');
    expect(live).toHaveLength(0);

    // And the reservation cleared: a genuinely-new serve for the same criterion now proceeds.
    const r = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke() });
    expect(r.leafIds).toHaveLength(2);
    expect(getTodo(project, r.epicId)?.status).not.toBe('dropped');
  });

  test('dropping serving epic re-derives discover and permits re-planning', async () => {
    const { missionId, criterionId } = await approvedMission();

    // First call: plan an epic to serve the criterion.
    const r1 = await planMissionCriterion(
      project,
      { session: 's1', missionId, criterionIds: [criterionId] },
      { invoke: mockInvoke() },
    );

    // Drop the serving epic.
    await updateTodo(project, r1.epicId, { status: 'dropped' });

    // Criterion should re-derive 'discover'.
    expect(listCriteriaWithActions(project, missionId).find(c => c.id === criterionId)!.action).toBe('discover');

    // Plan again for the same criterion with a fresh invoke — should succeed and return a new epic id.
    const r2 = await planMissionCriterion(
      project,
      { session: 's1', missionId, criterionIds: [criterionId] },
      { invoke: mockInvoke() },
    );
    expect(r2.epicId).not.toBe(r1.epicId);

    // Two epics should exist under the mission serving that criterion (lifetime count).
    const todos = listTodos(project, { includeCompleted: true });
    const epics = todos.filter((t) => t.kind === 'epic' && t.parentId === missionId);
    expect(epics.length).toBe(2);
  });

  test('creation-recency guard refuses a duplicate serve even when the derived action reads discover', async () => {
    const { missionId, criterionId } = await approvedMission();
    const blockedSpec = { title: 'T', leaves: [{ title: 'L', dependsOn: ['no-such-dep-id'] }] };

    const r1 = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke(blockedSpec) });

    // Sanity: OLD derived-action mechanism alone reads 'discover' here (no ready/in_progress child).
    expect(listCriteriaWithActions(project, missionId).find(c => c.id === criterionId)!.action).toBe('discover');

    // Within the grace window: refused despite the 'discover' action.
    let invoked = 0;
    await expect(
      planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: async () => { invoked++; return {} as any; } }),
    ).rejects.toThrow(ServeIntegrityError);
    expect(invoked).toBe(0);

    // Backdate epic 1's createdAt past CHILDLESS_SERVE_GRACE_MS (raw SQL, same technique as
    // src/services/__tests__/mission-store.test.ts:645-648), then re-open the project db.
    const db = new Database(join(project, '.collab', 'todos.db'));
    const past = new Date(Date.now() - CHILDLESS_SERVE_GRACE_MS - 60_000).toISOString();
    db.exec(`UPDATE todos SET createdAt = '${past}' WHERE id = '${r1.epicId}'`);
    db.close();
    closeTodos(project);

    // Past the grace window: proceeds — a second, distinct epic is created.
    const r2 = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke(blockedSpec) });
    expect(r2.epicId).not.toBe(r1.epicId);
  });
});

describe('parseEpicSpec + buildPlannerPrompt (pure)', () => {
  test('parses a spec and requires title + at least one leaf', () => {
    const s = parseEpicSpec('```json\n{"title":"E","leaves":[{"title":"L1"},{"title":""}]}\n```');
    expect(s.title).toBe('E');
    expect(s.leaves).toHaveLength(1);
    expect(() => parseEpicSpec('{"title":"E","leaves":[]}')).toThrow(/no leaves/i);
    expect(() => parseEpicSpec('{"leaves":[{"title":"L"}]}')).toThrow(/title/i);
  });
  test('prompt lists the criteria and forbids creating/editing', () => {
    const p = buildPlannerPrompt('/proj', 'm1', [{ id: 'c1', text: 'the thing works' }]);
    expect(p).toContain('c1');
    expect(p).toContain('the thing works');
    expect(p).toContain('Do NOT create anything');
  });
});
