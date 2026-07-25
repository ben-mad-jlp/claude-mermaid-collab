import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stable supervisor dir (watched_project + node_profile_override caches); per-test project dir keeps
// the mission/decision/todo stores fresh.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass, conductorFingerprint, buildConductorPrompt, CRITERION_SERVE_CAP_KIND, serveCapMarker, CONDUCTOR_SERVE_RETRY_CAP, buildServeCapDiagnosis } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled, createEscalation, listOpenEscalations, listEscalations, acknowledgeEscalation, resolveEscalation, getConductorTargetMission, setConductorTargetMission, getConductorLastPass, type Escalation } from '../supervisor-store';
import { getMission, _resetMissionDbCache, setMissionAbandoned, setCriterionMet, setMissionBudget, CRITERION_SERVE_CAP, listMissions, listCriteriaWithActions, isMissionTerminal, enqueueRecheck } from '../mission-store';
import { _resetMissionSpendMemo } from '../ledger-stats';
import { REBET_KIND, rebetConditionKey } from '../rebet-briefing';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { planMissionCriterion } from '../../mcp/tools/mission-planner';
import { listCriteria } from '../mission-store';
import { createTodo, updateTodo } from '../todo-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { invokeNode, _primeAuthCacheForTest, _resetAuthCache, _resetClaudeBinCache } from '../../agent/node-invoker';
import { recordNode } from '../worker-ledger';
import { recordApproachAttempt } from '../criterion-approach-store';

let project: string;
let invokeCalls: number;
/** Faithful "successful conductor node" mock: like the real node, it SERVES the active mission's
 *  open 'discover' gaps by filing a serving epic, so the productive-pass guard sees real progress.
 *  (A bare ok with no epic is the LLM-no-op WEDGE — see emptyServeInvoke.) */
const okInvoke = async () => {
  invokeCalls++;
  // Mirror the pass's own target selection (pin → active) so the mock serves the SAME mission the
  // pass drives.
  const pin = getConductorTargetMission(project);
  const missions = listMissions(project);
  const m = pin
    ? missions.find((x) => x.node.id === pin)
    : missions.find((x) => x.mission.active && !isMissionTerminal(x.mission));
  if (m) {
    for (const c of listCriteriaWithActions(project, m.node.id).filter((x) => x.action === 'discover')) {
      await createTodo(project, { ownerSession: 's1', title: `[EPIC] served ${c.id}`, kind: 'epic', parentId: m.node.id, servesCriterionIds: [c.id] });
    }
  }
  return { ok: true, rateLimited: false, text: 'served the gap' } as any;
};
/** The WEDGE mock: a conductor node that returns ok but files NO epic (LLM no-op / swallowed
 *  plan_mission_criterion). Must NOT stamp the success fp — the mission must retry, not debounce. */
const emptyServeInvoke = async () => { invokeCalls++; return { ok: true, rateLimited: false, text: 'looked but did nothing' } as any; };

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
});

async function forgeApprovedActive() {
  return forgeMission(project, { session: 's1', title: 'The reviewer never over-rejects', criteria: ['a correct leaf is accepted'] });
}

/** Forge an approved+active mission whose single criterion has burned CRITERION_SERVE_CAP
 *  serving epics (all dropped → no live serving epic) so it derives action 'escalate'.
 *  By default, records a 're-decompose' rung so existing tests keep carding unchanged. */
async function forgeCappedMission(title = 'MEASURED-live: p95 latency < 100ms in prod', opts?: { suppressRung?: boolean }) {
  const forged = await forgeMission(project, { session: 's1', title, criteria: ['p95 latency measured under 100ms on the live deploy'] });
  const crit = listCriteria(project, forged.missionId)[0];
  for (let i = 0; i < CRITERION_SERVE_CAP; i++) {
    const e = await createTodo(project, { ownerSession: 's1', title: `[EPIC] serve ${i}`, kind: 'epic', parentId: forged.missionId, servesCriterionIds: [crit.id] });
    await updateTodo(project, e.id, { status: 'dropped' });
  }
  // Record a 're-decompose' rung by default unless suppressed
  if (!opts?.suppressRung) {
    recordApproachAttempt({
      criterionId: crit.id,
      missionId: forged.missionId,
      project,
      rung: 're-decompose',
      epicId: null,
      outcome: 'attempted',
      detail: null,
      attemptedAt: Date.now(),
    });
  }
  return { forged, crit };
}

describe('runConductorPass — scheduling', () => {
  test('disabled toggle ⇒ no-op, no node spawned', async () => {
    await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('conductor-disabled');
    expect(invokeCalls).toBe(0);
  });

  test('daemon OFF ⇒ conductor no-ops (it only directs the daemon; no daemon = nothing builds)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    setOrchestratorLevel(project, 'off');
    await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('daemon-off');
    expect(invokeCalls).toBe(0);
  });

  test('enabled but no approved/active mission ⇒ no-actionable-mission', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('no-actionable-mission');
    expect(invokeCalls).toBe(0);
  });

  test('enabled + approved active mission with a discover gap ⇒ spawns the conductor node', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted');
    expect(r.missionId).toBe(forged.missionId);
    expect(r.modelUsed).toBe('opus'); // conductor default (configurable via node_profile_override)
    expect(invokeCalls).toBe(1);
  });

  test('debounced: an identical second tick spends NO node (fingerprint unchanged)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    await runConductorPass(project, { invoke: okInvoke });
    expect(invokeCalls).toBe(1);
    const r2 = await runConductorPass(project, { invoke: okInvoke });
    expect(r2.ran).toBe(false);
    expect(r2.reason).toBe('debounced');
    expect(invokeCalls).toBe(1); // still 1 — no second node
  });

  test('a FAILED serve retries up to the cap, then stops — never a permanent wedge, never infinite thrash', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    let failCalls = 0;
    const failInvoke = async () => { failCalls++; return { ok: false, rateLimited: false, text: '' } as any; };
    // Each tick on the SAME unservable state: retries CONDUCTOR_SERVE_RETRY_CAP (3) times (node-failed),
    // then debounces (no more node spawned). The OLD bug stamped the plain fp on the FIRST failure and
    // debounced forever (0 epics, permanent wedge). The fix bounds the retry instead.
    for (let i = 0; i < CONDUCTOR_SERVE_RETRY_CAP; i++) {
      const r = await runConductorPass(project, { invoke: failInvoke });
      expect(r.ran).toBe(true);
      expect(r.reason).toBe('node-failed');
    }
    expect(failCalls).toBe(CONDUCTOR_SERVE_RETRY_CAP); // retried, did not wedge on the first failure
    const capped = await runConductorPass(project, { invoke: failInvoke });
    expect(capped.ran).toBe(false);
    expect(capped.reason).toBe('debounced'); // stopped — no infinite thrash
    expect(failCalls).toBe(CONDUCTOR_SERVE_RETRY_CAP); // no further node spawned past the cap
  });

  test('transient (rateLimited) failures never stamp the fail counter or wedge the mission', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    let rateLimitCalls = 0;
    const rateLimitedInvoke = async () => { rateLimitCalls++; return { ok: false, rateLimited: true, text: '' } as any; };
    const n = CONDUCTOR_SERVE_RETRY_CAP + 2;
    for (let i = 0; i < n; i++) {
      const r = await runConductorPass(project, { invoke: rateLimitedInvoke });
      expect(r.ran).toBe(true);
      expect(r.reason).toBe('node-failed');
    }
    // Invoke ran on EVERY tick — never debounced, unlike the structural-failure cap.
    expect(rateLimitCalls).toBe(n);
    const key = getMission(project, forged.missionId)?.lastConductorKey ?? '';
    expect(key.includes('|fail:')).toBe(false);
  });

  describe('transient (real producer): startFailure and timedOut never stamp the fail counter', () => {
    const realCwd = mkdtempSync(join(tmpdir(), 'conductor-real-cwd-'));
    let stubDir: string;

    beforeEach(() => {
      stubDir = mkdtempSync(join(tmpdir(), 'conductor-claude-stub-'));
      _resetAuthCache();
      _resetClaudeBinCache();
      _primeAuthCacheForTest('subscription');
      process.env.MERMAID_TEST_ALLOW_DETACHED = '1';
    });

    afterEach(() => {
      delete process.env.CLAUDE_BIN;
      delete process.env.MERMAID_TEST_ALLOW_DETACHED;
      _resetAuthCache();
      _resetClaudeBinCache();
    });

    test('transient (startFailure, real spawn ENOENT) failures never stamp the fail counter or wedge the mission', async () => {
      addWatchedProject(project);
      setConductorEnabled(project, true);
      const forged = await forgeApprovedActive();

      process.env.CLAUDE_BIN = join(stubDir, 'does-not-exist');
      const real = await invokeNode({ prompt: 'x', cwd: realCwd });
      expect(real.startFailure != null).toBe(true);
      expect(real.startFailure!.detail).toContain('spawn failed');

      let calls = 0;
      const invoke = async () => { calls++; return real; };
      const n = CONDUCTOR_SERVE_RETRY_CAP + 2;
      for (let i = 0; i < n; i++) {
        const r = await runConductorPass(project, { invoke });
        expect(r.ran).toBe(true);
        expect(r.reason).toBe('node-failed');
      }
      expect(calls).toBe(n);
      const key = getMission(project, forged.missionId)?.lastConductorKey ?? '';
      expect(key.includes('|fail:')).toBe(false);
    });

    test('transient (timedOut, real start-window kill) failures never stamp the fail counter or wedge the mission', async () => {
      addWatchedProject(project);
      setConductorEnabled(project, true);
      const forged = await forgeApprovedActive();

      const stubPath = join(stubDir, 'claude-hang');
      writeFileSync(stubPath, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
      chmodSync(stubPath, 0o755);
      process.env.CLAUDE_BIN = stubPath;
      const real = await invokeNode({ prompt: 'x', cwd: realCwd, timeoutMs: 30_000, startWindowMs: 250 });
      expect(real.timedOut).toBe(true);

      let calls = 0;
      const invoke = async () => { calls++; return real; };
      const n = CONDUCTOR_SERVE_RETRY_CAP + 2;
      for (let i = 0; i < n; i++) {
        const r = await runConductorPass(project, { invoke });
        expect(r.ran).toBe(true);
        expect(r.reason).toBe('node-failed');
      }
      expect(calls).toBe(n);
      const key = getMission(project, forged.missionId)?.lastConductorKey ?? '';
      expect(key.includes('|fail:')).toBe(false);
    });
  });

  test('incident 3c04657b: 3 transient rate-limited passes leave no wedge — the next live tick proceeds', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    const rateLimitedInvoke = async () => { invokeCalls++; return { ok: false, rateLimited: true, text: '' } as any; };
    for (let i = 0; i < 3; i++) {
      const r = await runConductorPass(project, { invoke: rateLimitedInvoke });
      expect(r.reason).toBe('node-failed');
    }
    const r4 = await runConductorPass(project, { invoke: okInvoke });
    expect(r4.ran).toBe(true);
    expect(r4.reason).toBe('conducted');
  });

  test('a capped unservable serve-state stays capped when an unrelated land card flips (no token re-churn)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    // Cap the mission on an UNSERVABLE discover gap: the node returns ok but files no epic, so the
    // criterion stays 'discover' and the serve-state never moves. Retries to the cap, then stops.
    for (let i = 0; i < CONDUCTOR_SERVE_RETRY_CAP; i++) {
      await runConductorPass(project, { invoke: emptyServeInvoke });
    }
    expect(invokeCalls).toBe(CONDUCTOR_SERVE_RETRY_CAP);
    const cappedBefore = await runConductorPass(project, { invoke: emptyServeInvoke });
    expect(cappedBefore.reason).toBe('debounced');
    expect(invokeCalls).toBe(CONDUCTOR_SERVE_RETRY_CAP); // capped — no extra node

    // An UNRELATED epic-ready-to-land card appears project-wide (landCards 0 → 1). This used to change
    // the fail fingerprint and reset the retry counter, re-spawning CONDUCTOR_SERVE_RETRY_CAP fresh
    // nodes on the same unservable state. The cap now keys on the serve-state alone, so it must HOLD.
    createEscalation({ project, session: 'coordinator', kind: 'epic-ready-to-land', questionText: 'ready', todoId: null });
    const afterLandCard = await runConductorPass(project, { invoke: emptyServeInvoke });
    expect(afterLandCard.ran).toBe(false);
    expect(afterLandCard.reason).toBe('debounced');
    expect(invokeCalls).toBe(CONDUCTOR_SERVE_RETRY_CAP); // STILL capped — the land-card flip spent no node
  });

  test('a build-green mission (criterion building) STILL runs when an epic-ready-to-land card is open (to land it)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    // Plan an epic for the criterion → criterion action becomes 'building' (serving epic open).
    const crit = listCriteria(project, forged.missionId)[0];
    await planMissionCriterion(project, { session: 's1', missionId: forged.missionId, criterionIds: [crit.id] }, {
      invoke: async () => ({ ok: true, rateLimited: false, text: JSON.stringify({ title: 'E', leaves: [{ title: 'L' }] }) } as any),
    });
    // No land card yet → building-wait (daemon is working; nothing to direct).
    const wait = await runConductorPass(project, { invoke: okInvoke });
    expect(wait.reason).toBe('building-wait');
    expect(invokeCalls).toBe(0);
    // A build-green epic surfaces an epic-ready-to-land card → the conductor MUST run to land it.
    // (Real land cards carry the epic id, a mission descendant — mirror that with the mission id
    // itself so the card is in-scope for the mission-scoped signature.)
    createEscalation({ project, session: 'coordinator', kind: 'epic-ready-to-land', questionText: 'ready', todoId: forged.missionId });
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted');
    expect(invokeCalls).toBe(1);
  });

  test('an UNAPPROVED mission is never driven', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeMission(project, { session: 's1', title: 'pending', criteria: ['c'], approved: false });
    expect(getMission(project, forged.missionId)?.status).toBe('unapproved');
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('no-actionable-mission');
    expect(invokeCalls).toBe(0);
  });
});

describe('runConductorPass — over-budget re-bet (mission a6ab522b)', () => {
  /** Forge an approved+active mission with a ceiling, then burn past it in the ledger so
   *  getMissionSpend (the SAME reader deriveMissionStatus uses) reports over-budget. */
  async function forgeOverBudget(budgetUsd: number, spendUsd: number) {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    setOrchestratorLevel(project, 'on');
    const forged = await forgeMission(project, {
      session: 's1', title: 'burn the budget', criteria: ['a thing is true'], budgetUsd,
    });
    recordNode({
      project, todoId: forged.missionId, session: 's1', nodeKind: 'node',
      costUsd: spendUsd, knownPrice: true, nodesSpent: 1, model: 'claude-x',
    });
    _resetMissionSpendMemo();
    return forged;
  }

  test('an over-budget mission raises ONE re-bet card and spends ZERO conductor nodes', async () => {
    const forged = await forgeOverBudget(50, 62.5);
    expect(getMission(project, forged.missionId)?.status).toBe('over-budget');

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('over-budget-rebet');
    expect(invokeCalls).toBe(0); // the whole point: the final act costs no model spend

    const cards = listOpenEscalations().filter((e) => e.project === project && e.kind === REBET_KIND);
    expect(cards).toHaveLength(1);
    expect(cards[0].todoId).toBe(forged.missionId);
    expect(cards[0].conditionKey).toBe(rebetConditionKey(forged.missionId, 50));
    expect((cards[0].options ?? []).map((o) => o.id).sort()).toEqual(['drop-criteria', 'park-and-reshape', 'raise']);
    expect(cards[0].questionText).toContain('OVER BUDGET');
  });

  test('N further ticks: still ONE card, still zero nodes', async () => {
    await forgeOverBudget(50, 62.5);
    for (let i = 0; i < 5; i++) {
      _resetMissionSpendMemo();
      const r = await runConductorPass(project, { invoke: okInvoke });
      expect(r.reason).toBe('over-budget-rebet');
    }
    expect(invokeCalls).toBe(0);
    expect(listOpenEscalations().filter((e) => e.project === project && e.kind === REBET_KIND)).toHaveLength(1);
  });

  test('raising the budget above spend → the conductor RESUMES (a node runs again)', async () => {
    const forged = await forgeOverBudget(50, 62.5);
    expect((await runConductorPass(project, { invoke: okInvoke })).reason).toBe('over-budget-rebet');
    expect(invokeCalls).toBe(0);

    setMissionBudget(project, forged.missionId, 200, { actor: 'test', reason: 're-bet: raise' });
    _resetMissionSpendMemo();
    expect(getMission(project, forged.missionId)?.status).not.toBe('over-budget');

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.reason).not.toBe('over-budget-rebet');
    expect(invokeCalls).toBeGreaterThan(0);
  });

  test('crossing the NEW ceiling raises exactly one FRESH card (the old key is not reused)', async () => {
    const forged = await forgeOverBudget(50, 62.5);
    await runConductorPass(project, { invoke: okInvoke });
    setMissionBudget(project, forged.missionId, 100, { actor: 'test', reason: 're-bet: raise' });
    recordNode({
      project, todoId: forged.missionId, session: 's1', nodeKind: 'node',
      costUsd: 50, knownPrice: true, nodesSpent: 1, model: 'claude-x',
    });
    _resetMissionSpendMemo();
    expect(getMission(project, forged.missionId)?.status).toBe('over-budget');

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.reason).toBe('over-budget-rebet');
    const cards = listOpenEscalations().filter((e) => e.project === project && e.kind === REBET_KIND);
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.conditionKey))).toEqual(
      new Set([rebetConditionKey(forged.missionId, 50), rebetConditionKey(forged.missionId, 100)]),
    );
  });

  test('FAIL OPEN: a throwing card path leaves the pass returning normally', async () => {
    await forgeOverBudget(50, 62.5);
    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: (() => { throw new Error('escalation store down'); }) as never,
    });
    expect(r.reason).toBe('over-budget-rebet');
    expect(r.escalationsRaised).toBe(0);
    expect(invokeCalls).toBe(0);
  });
});

describe('runConductorPass — target pin', () => {
  test('pin swaps which mission is driven', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const first = await forgeApprovedActive();
    const second = await forgeMission(project, { session: 's1', title: 'Second mission to drive', criteria: ['a second correct leaf is accepted'] });

    setConductorTargetMission(project, second.missionId);
    const r1 = await runConductorPass(project, { invoke: okInvoke });
    expect(r1.ran).toBe(true);
    expect(r1.reason).toBe('conducted');
    expect(r1.missionId).toBe(second.missionId);

    setConductorTargetMission(project, first.missionId);
    const r2 = await runConductorPass(project, { invoke: okInvoke });
    expect(r2.ran).toBe(true);
    expect(r2.reason).toBe('conducted');
    expect(r2.missionId).toBe(first.missionId);
  });

  test('EMPTY SERVE self-heals: node returns ok but files no epic → retries (bounded), never debounces', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive(); // one 'discover' criterion

    // A conductor node that returns ok but serves NOTHING must NOT stamp the success fp (which would
    // debounce a still-unmet mission forever — the 9688e874 wedge). It retries up to the cap, THEN
    // (with the gap still unserved and now capped) raises the serve-cap escalation.
    for (let i = 0; i < CONDUCTOR_SERVE_RETRY_CAP; i++) {
      const r = await runConductorPass(project, { invoke: emptyServeInvoke });
      expect(r.ran).toBe(true);
      expect(r.reason).toBe('node-failed'); // empty serve is NOT counted as 'conducted'
    }
    expect(invokeCalls).toBe(CONDUCTOR_SERVE_RETRY_CAP); // retried each tick — did NOT debounce after the 1st
    // Past the cap: stops respinning the node on the same unservable state.
    const capped = await runConductorPass(project, { invoke: emptyServeInvoke });
    expect(capped.ran).toBe(false);
    expect(capped.reason).toBe('debounced');
    expect(invokeCalls).toBe(CONDUCTOR_SERVE_RETRY_CAP); // no further node spawned

  });

  test('a node that ACTUALLY serves the gap is productive (conducted)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    const r1 = await runConductorPass(project, { invoke: okInvoke });
    expect(r1.ran).toBe(true);
    expect(r1.reason).toBe('conducted'); // served a real gap → productive
  });

  test('unpinned single mission still uses first-active', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted');
    expect(r.missionId).toBe(forged.missionId);
  });

  test('pin an awaiting-approval mission while another actionable mission exists ⇒ target-not-actionable, never falls back', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    const unapproved = await forgeMission(project, { session: 's1', title: 'pending pin target', criteria: ['c'], approved: false });

    setConductorTargetMission(project, unapproved.missionId);
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('target-not-actionable');
    expect(r.missionId).toBe(unapproved.missionId);
    expect(invokeCalls).toBe(0);
  });

  test('pin a missing mission clears it lazily', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();

    setConductorTargetMission(project, 'deadbeef-0000-0000-0000-000000000000');
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('target-cleared');
    expect(invokeCalls).toBe(0);
    expect(getConductorTargetMission(project)).toBe(null);
  });

  // Convergence now freezes the mission into the terminal 'closed' state, so the
  // observable status differs from the case label; the pin must clear on EITHER.
  test.each([
    ['converged', 'closed'],
    ['abandoned', 'abandoned'],
  ] as const)(
    'pinning a %s mission clears the pin and drives nothing (not even the other actionable mission)',
    async (terminalStatus, expectedStatus) => {
      addWatchedProject(project);
      setConductorEnabled(project, true);
      // A second, actionable mission that MUST NOT be driven as a fallback.
      const fallback = await forgeApprovedActive();
      const target = await forgeMission(project, { session: 's1', title: 'Pin target going terminal', criteria: ['a terminal-status criterion'] });

      if (terminalStatus === 'converged') {
        const crit = listCriteria(project, target.missionId)[0];
        setCriterionMet(project, crit.id, true);
      } else {
        setMissionAbandoned(project, target.missionId, 1);
      }
      expect(getMission(project, target.missionId)?.status).toBe(expectedStatus);

      setConductorTargetMission(project, target.missionId);
      const r = await runConductorPass(project, { invoke: okInvoke });
      expect(r.ran).toBe(false);
      expect(r.reason).toBe('target-cleared');
      expect(invokeCalls).toBe(0);
      expect(getConductorTargetMission(project)).toBe(null);
      void fallback;
    },
  );

  test('records lastPass reason "conducted" for the pinned mission id', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    setConductorTargetMission(project, forged.missionId);

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.reason).toBe('conducted');

    const lastPass = getConductorLastPass(project);
    expect(lastPass).not.toBeNull();
    expect(lastPass!.missionId).toBe(forged.missionId);
    expect(lastPass!.reason).toBe('conducted');
    expect(typeof lastPass!.tickAt).toBe('number');
  });

  test('an unrelated actionable mission never appears in lastPass.missionId', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const pinned = await forgeApprovedActive();
    const unrelated = await forgeMission(project, { session: 's1', title: 'Unrelated actionable mission', criteria: ['an unrelated criterion'] });

    setConductorTargetMission(project, pinned.missionId);
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.reason).toBe('conducted');

    const lastPass = getConductorLastPass(project);
    expect(lastPass!.missionId).toBe(pinned.missionId);
    expect(lastPass!.missionId).not.toBe(unrelated.missionId);
  });

  test('records lastPass reason "target-cleared" once the pinned mission goes terminal', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const target = await forgeApprovedActive();
    setMissionAbandoned(project, target.missionId, 1);

    setConductorTargetMission(project, target.missionId);
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.reason).toBe('target-cleared');

    const lastPass = getConductorLastPass(project);
    expect(lastPass).toEqual({ missionId: null, reason: 'target-cleared', tickAt: lastPass!.tickAt });
    expect(typeof lastPass!.tickAt).toBe('number');
  });
});

describe('runConductorPass — criterion serve-cap escalation', () => {
  test('an escalate-only mission raises exactly ONE escalation and does NOT spawn the conductor node', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [], // nothing open yet
    });

    expect(r.ran).toBe(false);
    expect(r.reason).toBe('criteria-escalated');
    expect(r.missionId).toBe(forged.missionId);
    expect(r.escalationsRaised).toBe(1);
    expect(invokeCalls).toBe(0); // node NOT spawned for a capped criterion
    // exactly one escalation, well-formed: kind, todoId=missionId, operator-gated, criterion marker + count
    expect(escCalls.length).toBe(1);
    expect(escCalls[0].kind).toBe(CRITERION_SERVE_CAP_KIND);
    expect(escCalls[0].todoId).toBe(forged.missionId);
    expect(escCalls[0].operatorGated).toBe(true);
    expect(escCalls[0].questionText).toContain(serveCapMarker(crit.id));
    expect(escCalls[0].questionText).toContain(String(CRITERION_SERVE_CAP));
  });

  test('debounced: a second pass with an already-open criterion-serve-cap escalation does NOT create a duplicate', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();

    // Real store: the first pass raises the card via the keyed conditionKey path.
    const r1 = await runConductorPass(project, { invoke: okInvoke });
    expect(r1.reason).toBe('criteria-escalated');
    expect(r1.escalationsRaised).toBe(1);

    // Second pass against the same open card: the store's conditionKey dedup bumps it
    // in place instead of creating a duplicate.
    const r2 = await runConductorPass(project, { invoke: okInvoke });
    expect(r2.reason).toBe('criteria-escalated');
    expect(r2.escalationsRaised).toBe(0);
    expect(invokeCalls).toBe(0);

    const matching = listEscalations().filter(
      (e) => e.kind === CRITERION_SERVE_CAP_KIND && e.todoId === forged.missionId && e.questionText.includes(serveCapMarker(crit.id)),
    );
    expect(matching.length).toBe(1);
  });

  test('a resolved serve-cap card for the same criterion is not re-raised', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();

    const r1 = await runConductorPass(project, { invoke: okInvoke });
    expect(r1.escalationsRaised).toBe(1);
    const first = listEscalations().find(
      (e) => e.kind === CRITERION_SERVE_CAP_KIND && e.todoId === forged.missionId && e.questionText.includes(serveCapMarker(crit.id)),
    )!;
    resolveEscalation(first.id, 'resolved');

    const r2 = await runConductorPass(project, { invoke: okInvoke });
    expect(r2.escalationsRaised).toBe(0);
    const matching = listEscalations().filter(
      (e) => e.kind === CRITERION_SERVE_CAP_KIND && e.todoId === forged.missionId && e.questionText.includes(serveCapMarker(crit.id)),
    );
    expect(matching.length).toBe(1);
    expect(matching[0].status).toBe('resolved');
  });

  test('a repeated pass bumps recurrenceCount on the single open serve-cap card rather than creating a second', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();

    await runConductorPass(project, { invoke: okInvoke });
    await runConductorPass(project, { invoke: okInvoke });

    const matching = listEscalations().filter(
      (e) => e.kind === CRITERION_SERVE_CAP_KIND && e.todoId === forged.missionId && e.questionText.includes(serveCapMarker(crit.id)),
    );
    expect(matching.length).toBe(1);
    expect(matching[0].recurrenceCount).toBe(1);
  });

  test('end-to-end with the real store: two consecutive passes leave exactly ONE open serve-cap card', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();

    // Real createEscalation + listOpenEscalations (defaults). First pass raises it.
    const r1 = await runConductorPass(project, { invoke: okInvoke });
    expect(r1.reason).toBe('criteria-escalated');
    expect(r1.escalationsRaised).toBe(1);
    // Second pass finds the open card → no duplicate.
    const r2 = await runConductorPass(project, { invoke: okInvoke });
    expect(r2.escalationsRaised).toBe(0);

    const open = listOpenEscalations().filter(
      (e) => e.kind === CRITERION_SERVE_CAP_KIND && e.todoId === forged.missionId && e.questionText.includes(serveCapMarker(crit.id)),
    );
    expect(open.length).toBe(1);
    expect(invokeCalls).toBe(0);

    // Third pass after acknowledging: acknowledged cards are also de-duped; no re-raise.
    const cardId = open[0].id;
    acknowledgeEscalation(cardId);

    const r3 = await runConductorPass(project, { invoke: okInvoke });
    expect(r3.escalationsRaised).toBe(0); // No duplicate is filed for acknowledged card.

    // Exactly one escalation matches the criterion marker (now in acknowledged state).
    const allMatching = listEscalations().filter(
      (e) => e.kind === CRITERION_SERVE_CAP_KIND && e.todoId === forged.missionId && e.questionText.includes(serveCapMarker(crit.id)),
    );
    expect(allMatching.length).toBe(1);
    expect(allMatching[0].status).toBe('acknowledged');
  });

  test('serve-cap with unexhausted ladder — defers and raises no card', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission(undefined, { suppressRung: true });

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [],
    });

    expect(r.ran).toBe(false);
    expect(r.reason).toBe('criteria-escalated');
    expect(r.escalationsRaised).toBe(0); // no card raised
    expect(r.serveCapDeferred).toBe(1); // deferred instead
    expect(escCalls.length).toBe(0); // no escalation created
    expect(invokeCalls).toBe(0);
  });

  test('serve-cap with exhausted ladder — emits diagnosis with reasons, rung outcomes, and RECOMMEND', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [],
    });

    expect(r.ran).toBe(false);
    expect(r.reason).toBe('criteria-escalated');
    expect(r.escalationsRaised).toBe(1);
    expect(escCalls.length).toBe(1);
    const qt = escCalls[0].questionText;
    expect(qt).toContain('re-decompose');
    expect(qt).toContain('attempted');
    expect(qt).toContain('RECOMMEND');
  });

  test('serve-cap at count+1 with empty ladder — raises card with backstop message', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission(undefined, { suppressRung: true });
    // Create one more epic to push count beyond cap
    const e = await createTodo(project, { ownerSession: 's1', title: '[EPIC] extra', kind: 'epic', parentId: forged.missionId, servesCriterionIds: [crit.id] });
    await updateTodo(project, e.id, { status: 'dropped' });

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [],
    });

    expect(r.ran).toBe(false);
    expect(r.reason).toBe('criteria-escalated');
    expect(r.escalationsRaised).toBe(1);
    expect(escCalls.length).toBe(1);
    const qt = escCalls[0].questionText;
    expect(qt).toContain('fresh-blueprint');
    expect(qt).toContain('tier-bump');
    expect(qt).toContain('ladder incomplete');
  });

  test('serve-cap with store fault on listApproachAttempts — treats as exhausted and raises card', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission(undefined, { suppressRung: true });

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;

    const throwingListApproachAttempts = () => {
      throw new Error('store fault');
    };

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [],
      listApproachAttempts: throwingListApproachAttempts as any,
    });

    expect(r.ran).toBe(false);
    expect(r.reason).toBe('criteria-escalated');
    expect(r.escalationsRaised).toBe(1); // card raised despite fault
    expect(escCalls.length).toBe(1);
  });
});

describe('runConductorPass — mission-scoped card ids in the signature', () => {
  test('un-sleep: a blocker card on a mission todo wakes a debounced mission; resolving it moves the signature again', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    await runConductorPass(project, { invoke: okInvoke });
    expect(invokeCalls).toBe(1);
    const debounced = await runConductorPass(project, { invoke: okInvoke });
    expect(debounced.reason).toBe('debounced');
    expect(invokeCalls).toBe(1);

    const { escalation } = createEscalation({
      project, session: 's1', kind: 'blocker', todoId: forged.missionId, questionText: 'stuck leaf under this mission',
    });

    const r2 = await runConductorPass(project, { invoke: okInvoke });
    expect(r2.reason).not.toBe('debounced');
    expect(invokeCalls).toBe(2);

    resolveEscalation(escalation.id, 'resolved');
    const r3 = await runConductorPass(project, { invoke: okInvoke });
    expect(r3.reason).not.toBe('debounced');
  });

  test('self-excitation: a pass whose only delta is its own leaf-infra-rejected card does not re-arm', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const crit = listCriteria(project, forged.missionId)[0];
    const epic = await createTodo(project, {
      ownerSession: 's1', title: '[EPIC] serving epic', kind: 'epic', parentId: forged.missionId, servesCriterionIds: [crit.id],
    });
    await updateTodo(project, epic.id, { status: 'ready' });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'the stuck leaf', parentId: epic.id, status: 'ready' });
    await updateTodo(project, leaf.id, { acceptanceStatus: 'rejected' });
    recordNode({
      project, todoId: leaf.id, epicId: epic.id, leafId: leaf.id, session: 's1', nodeKind: 'outcome',
      nodesSpent: 0, leafOutcome: 'rejected',
      outcomeDetail: JSON.stringify({ reason: 'epic-base-red: npx tsc --noEmit\n--- output (tail) ---\nerror TS2345' }),
    });
    const failProbe = async () => 'fail' as const;

    // First pass: the INFRA arm cannot prove the base green ⇒ raises exactly one leaf-infra-rejected
    // card. That card is genuinely new state (it breaks the debounce), so the node runs and its
    // post-pass self key folds in the card it just saw.
    const r1 = await runConductorPass(project, { invoke: okInvoke, epicBaseProbe: failProbe });
    expect(r1.reason).not.toBe('debounced');
    const callsAfterFirst = invokeCalls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second pass: SAME state — the card is still open (deduped, no new card raised) and nothing
    // else moved. The self key the first pass stamped now matches this pass's signature ⇒ debounced,
    // no second node.
    const r2 = await runConductorPass(project, { invoke: okInvoke, epicBaseProbe: failProbe });
    expect(r2.reason).toBe('debounced');
    expect(invokeCalls).toBe(callsAfterFirst);
  });
});

describe('conductorFingerprint + buildConductorPrompt (pure)', () => {
  test('fingerprint changes when a criterion action changes', () => {
    const a = conductorFingerprint('needs-discovery', [{ id: 'c1', action: 'discover' }]);
    const b = conductorFingerprint('building', [{ id: 'c1', action: 'building' }]);
    expect(a).not.toBe(b);
    // stable + order-independent
    expect(conductorFingerprint('x', [{ id: 'a', action: 'met' }, { id: 'b', action: 'discover' }]))
      .toBe(conductorFingerprint('x', [{ id: 'b', action: 'discover' }, { id: 'a', action: 'met' }]));
  });
  test('fingerprint changes when a criterion flips to rejected/parked even with the same action', () => {
    const a = conductorFingerprint('building', [{ id: 'c1', action: 'building', rejectedParked: 0 }]);
    const b = conductorFingerprint('building', [{ id: 'c1', action: 'building', rejectedParked: 1 }]);
    expect(a).not.toBe(b);
  });
  test('fingerprint is stable + order-independent when rejectedParked is unchanged', () => {
    const a = conductorFingerprint('x', [
      { id: 'a', action: 'met', rejectedParked: 2 },
      { id: 'b', action: 'discover', rejectedParked: 0 },
    ]);
    const b = conductorFingerprint('x', [
      { id: 'b', action: 'discover', rejectedParked: 0 },
      { id: 'a', action: 'met', rejectedParked: 2 },
    ]);
    expect(a).toBe(b);
  });
  test('prompt names the mission + session, forbids hand-editing, lands as conductor', () => {
    const p = buildConductorPrompt('/proj', 'm1', 'Ship the thing', 'sess-A');
    expect(p).toContain('m1');
    expect(p).toContain('Ship the thing');
    expect(p).toContain('sess-A');
    expect(p).toContain('hand-edit source');
    expect(p).toContain('land_epic');
    // Autonomous land via the conductor actor + ownership gate (not a bare land).
    expect(p).toContain('actor:');
    expect(p).toContain('"conductor"');
    expect(p).toContain('escalation_list');
  });
});

describe('runConductorPass — lastPass refreshes every beat', () => {
  test('debounced beat still refreshes lastPass', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();

    const r1 = await runConductorPass(project, { invoke: okInvoke });
    expect(r1.reason).toBe('conducted');
    const lastPass1 = getConductorLastPass(project);
    expect(lastPass1).not.toBeNull();

    const r2 = await runConductorPass(project, { invoke: okInvoke });
    expect(r2.reason).toBe('debounced');
    const lastPass2 = getConductorLastPass(project);
    expect(lastPass2).not.toBeNull();
    expect(lastPass2!.reason).toBe('debounced');
    expect(typeof lastPass2!.tickAt).toBe('number');
    expect(lastPass2!.tickAt >= lastPass1!.tickAt).toBe(true);
  });

  test('mid-flight invoke observes pass-ran before the node completes', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();

    let midFlightObserved = false;
    const missionId = forged.missionId;
    const flightInvoke = async () => {
      const mid = getConductorLastPass(project);
      if (mid && mid.reason === 'pass-ran' && mid.missionId === missionId) {
        midFlightObserved = true;
      }
      await new Promise(r => setTimeout(r, 5));
      // Mirror okInvoke's logic to serve the gap
      for (const c of listCriteriaWithActions(project, missionId).filter((x) => x.action === 'discover')) {
        await createTodo(project, { ownerSession: 's1', title: `[EPIC] served ${c.id}`, kind: 'epic', parentId: missionId, servesCriterionIds: [c.id] });
      }
      return { ok: true, rateLimited: false, text: 'served the gap' } as any;
    };

    const r = await runConductorPass(project, { invoke: flightInvoke });
    expect(r.reason).toBe('conducted');
    expect(midFlightObserved).toBe(true);
  });

  test('a throwing invoke leaves pass-error, not a stale prior reason, and rethrows', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const first = await forgeApprovedActive();
    await runConductorPass(project, { invoke: okInvoke });
    const staleLast = getConductorLastPass(project);
    expect(staleLast!.reason).toBe('conducted');

    const second = await forgeMission(project, { session: 's1', title: 'Fresh mission to error', criteria: ['error criterion'] });
    setConductorTargetMission(project, second.missionId);

    const throwInvoke = async () => { throw new Error('boom'); };
    await expect(runConductorPass(project, { invoke: throwInvoke })).rejects.toThrow('boom');

    const lastPass = getConductorLastPass(project);
    expect(lastPass).not.toBeNull();
    expect(lastPass!.reason).toBe('pass-error');
    expect(lastPass!.missionId).toBeNull();
  });
});

/**
 * WAKE CONTEXT wiring. The pure renderer's contract is covered in conductor-wake-context.test.ts;
 * these tests cover the PASS side — that the block reaches the node's prompt built from the values
 * the pass already holds, and that a render fault degrades to today's prompt instead of sinking the
 * pass. No module mocks: the wake-block builder and the resolved-card read are injected deps.
 */
describe('WAKE CONTEXT injection (the things that kick the conductor land in its context)', () => {
  test('buildConductorPrompt embeds the wake block ABOVE the steps when given one', () => {
    const block = '=== WAKE CONTEXT ===\nOPEN CARDS ON THIS MISSION\n=== END WAKE CONTEXT ===';
    const p = buildConductorPrompt('/p', 'm1', 'A mission', 's1', block);
    expect(p).toContain(block);
    expect(p.indexOf(block)).toBeLessThan(p.indexOf('You are the MISSION CONDUCTOR'));
    expect(p).toContain('Steps this pass:');
  });

  test('buildConductorPrompt still returns a valid prompt when the wake block is undefined or empty', () => {
    const bare = buildConductorPrompt('/p', 'm1', 'A mission', 's1');
    const empty = buildConductorPrompt('/p', 'm1', 'A mission', 's1', '   ');
    for (const p of [bare, empty]) {
      expect(p.startsWith('You are the MISSION CONDUCTOR')).toBe(true);
      expect(p).toContain('Steps this pass:');
      expect(p).toContain('WAKE CONTEXT'); // step 4 references it; the block itself is absent
      expect(p).not.toContain('OPEN CARDS ON THIS MISSION —');
    }
    expect(empty).toBe(bare); // empty ⇒ byte-identical to the pre-injection prompt
  });

  test('step 4 hands the cards over instead of telling the node to go fetch them', () => {
    const p = buildConductorPrompt('/p', 'm1', 'A mission', 's1');
    expect(p).toContain('OPEN CARDS ARE LISTED ABOVE in WAKE CONTEXT — act on them; do not go looking for them');
    expect(p).toContain('mcp__mermaid__escalation_list'); // still available for detail / other projects
  });

  test("a live pass injects the mission's OPEN card content (full id + kind + conditionKey) into the prompt", async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const created = createEscalation({
      project,
      session: 's1',
      kind: 'blocker',
      todoId: forged.missionId,
      conditionKey: 'blocker:wake-test',
      conditionTuple: ['blocker', 'wake-test'],
      questionText: 'the leaf cannot build because the fixture path moved',
    });
    let prompt = '';
    await runConductorPass(project, {
      invoke: async (spec: any) => { prompt = spec.prompt; return okInvoke(); },
    });
    expect(prompt).toContain('OPEN CARDS ON THIS MISSION');
    expect(prompt).toContain(created.escalation.id); // FULL id, not a short prefix
    expect(prompt).toContain('blocker:wake-test');
    expect(prompt).toContain('the leaf cannot build because the fixture path moved');
  });

  test('a mission with no open cards gets the explicit "none open" line, not a missing section', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    let prompt = '';
    await runConductorPass(project, {
      invoke: async (spec: any) => { prompt = spec.prompt; return okInvoke(); },
    });
    expect(prompt).toContain('none open');
  });

  test('the actionable-criteria work list reaches the prompt', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const crit = listCriteria(project, forged.missionId)[0];
    let prompt = '';
    await runConductorPass(project, {
      invoke: async (spec: any) => { prompt = spec.prompt; return okInvoke(); },
    });
    expect(prompt).toContain('Criteria ACTIONABLE right now');
    expect(prompt).toContain(`- ${crit.id} [discover]`);
  });

  test('FAIL OPEN: a throwing wake-block builder still produces a prompt and a normal pass', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    let prompt = '';
    const r = await runConductorPass(project, {
      buildWakeBlock: () => { throw new Error('wake render exploded'); },
      invoke: async (spec: any) => { prompt = spec.prompt; return okInvoke(); },
    });
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted');
    expect(prompt.startsWith('You are the MISSION CONDUCTOR')).toBe(true);
    expect(prompt).toContain('Steps this pass:');
  });

  test('FAIL OPEN: a throwing resolved-card read degrades to a block without the resolved section', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    let prompt = '';
    const r = await runConductorPass(project, {
      listEscalationsResolvedSince: () => { throw new Error('store down'); },
      invoke: async (spec: any) => { prompt = spec.prompt; return okInvoke(); },
    });
    expect(r.reason).toBe('conducted');
    expect(prompt).toContain('WAKE CONTEXT');
    expect(prompt).not.toContain('RESOLVED since your last pass');
  });

  test('pending rechecks from the drain are included in the wake block when non-empty', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const crit = listCriteria(project, forged.missionId)[0];
    enqueueRecheck(project, {
      criterionId: crit.id,
      todoId: forged.missionId,
      reason: 'land-diff-intersects-evidence',
      landedSha: 'deadbeef',
    });
    let prompt = '';
    await runConductorPass(project, {
      invoke: async (spec: any) => { prompt = spec.prompt; return okInvoke(); },
    });
    expect(prompt).toContain('REOPENED — needs re-verify');
    expect(prompt).toContain(crit.id);
    expect(prompt).toContain('land-diff-intersects-evidence');
  });
});

describe('buildServeCapDiagnosis (pure)', () => {
  test('emits REASONS SEEN, LADDER, and RECOMMEND blocks', () => {
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test criterion',
      servedEpicCount: 3,
      attempts: [
        { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 're-decompose', epicId: 'e1', outcome: 'attempted', detail: null, attemptedAt: 1 },
      ],
      distinctReasons: ['reason one', 'reason two'],
    });
    expect(diagnosis).toContain('REASONS SEEN');
    expect(diagnosis).toContain('LADDER');
    expect(diagnosis).toContain('RECOMMEND');
    expect(diagnosis).toContain('fresh-blueprint');
    expect(diagnosis).toContain('tier-bump');
    expect(diagnosis).toContain('re-decompose');
  });

  test('limits reasons to first 5 and each to 200 chars', () => {
    const longReason = 'a'.repeat(250);
    const reasons = Array.from({ length: 7 }, (_, i) => `reason ${i}`);
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [],
      distinctReasons: [longReason, ...reasons],
    });
    // Check that we don't see all 7 reasons (only first 5)
    expect(diagnosis).toContain('reason 0');
    expect(diagnosis).not.toContain('reason 5');
    // Check truncation of long reason
    expect(diagnosis).toContain('a'.repeat(200));
    expect(diagnosis).not.toContain('a'.repeat(250));
  });

  test('shows rung outcomes with details when present', () => {
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [
        { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'fresh-blueprint', epicId: null, outcome: 'attempted', detail: 'some context', attemptedAt: 1 },
      ],
      distinctReasons: [],
    });
    expect(diagnosis).toContain('fresh-blueprint — attempted, some context');
  });

  test('shows epicId when detail is null', () => {
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [
        { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'tier-bump', epicId: 'epic-123', outcome: 'attempted', detail: null, attemptedAt: 1 },
      ],
      distinctReasons: [],
    });
    expect(diagnosis).toContain('tier-bump — attempted, epic epic-123');
  });

  test('RECOMMEND: single reason, all rungs present', () => {
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [
        { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'fresh-blueprint', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 1 },
        { id: '2', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'tier-bump', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 2 },
        { id: '3', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 're-decompose', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 3 },
      ],
      distinctReasons: ['only one reason'],
    });
    expect(diagnosis).toContain('RECOMMEND: the criterion likely needs a human action / rescope: only one reason');
  });

  test('RECOMMEND: all rungs, multiple reasons', () => {
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [
        { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'fresh-blueprint', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 1 },
        { id: '2', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'tier-bump', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 2 },
        { id: '3', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 're-decompose', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 3 },
      ],
      distinctReasons: ['reason one', 'reason two'],
    });
    expect(diagnosis).toContain('RECOMMEND: all ladder rungs ran and the criterion is still unmet — human rescope');
  });

  test('RECOMMEND: missing rungs', () => {
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [],
      distinctReasons: [],
    });
    expect(diagnosis).toContain('RECOMMEND: ladder incomplete — fresh-blueprint, tier-bump, re-decompose never ran');
  });

  test('shows (none recorded) when no reasons', () => {
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [],
      distinctReasons: [],
    });
    expect(diagnosis).toContain('(none recorded)');
  });

  test('picks newest attempt when multiple for same rung', () => {
    const now = Date.now();
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [
        { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 're-decompose', epicId: 'e1', outcome: 'failed', detail: 'first attempt', attemptedAt: now - 1000 },
        { id: '2', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 're-decompose', epicId: 'e2', outcome: 'attempted', detail: 'second attempt', attemptedAt: now },
      ],
      distinctReasons: [],
    });
    expect(diagnosis).toContain('re-decompose — attempted, second attempt');
    expect(diagnosis).not.toContain('re-decompose — failed');
  });
});
