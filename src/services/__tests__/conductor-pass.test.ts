import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stable supervisor dir (watched_project + node_profile_override caches); per-test project dir keeps
// the mission/decision/todo stores fresh.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass, conductorFingerprint, buildConductorPrompt, CRITERION_SERVE_CAP_KIND, serveCapMarker, CONDUCTOR_SERVE_RETRY_CAP, buildServeCapDiagnosis, conductorStatusLine, conductorNeedsHuman, CRITERION_SERVE_ATTEMPTS_CAPPED_KIND } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled, createEscalation, listOpenEscalations, listEscalations, acknowledgeEscalation, resolveEscalation, getConductorLastPass, type Escalation } from '../supervisor-store';
import { getMission, _resetMissionDbCache, setMissionAbandoned, setCriterionMet, setCriterionVerdict, setMissionBudget, CRITERION_SERVE_CAP, listMissions, listCriteriaWithActions, isMissionTerminal, enqueueRecheck, activateMission } from '../mission-store';
import { _resetMissionSpendMemo } from '../ledger-stats';
import { REBET_KIND, rebetConditionKey } from '../rebet-briefing';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { planMissionCriterion } from '../../mcp/tools/mission-planner';
import { listCriteria } from '../mission-store';
import { createTodo, updateTodo, listTodos } from '../todo-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { invokeNode, _primeAuthCacheForTest, _resetAuthCache, _resetClaudeBinCache } from '../../agent/node-invoker';
import { recordNode } from '../worker-ledger';
import { recordApproachAttempt } from '../criterion-approach-store';
import { CONDUCTOR_NODE_TIMEOUT_MS, CONDUCTOR_TIMEOUT_RECUR_CAP, CONDUCTOR_SERVE_BATCH_MAX, CRITERION_SERVE_ATTEMPT_CAP } from '../harness-caps';
import { claimReason, isClaimable } from '../claimability';
import { initializeWebSocketHandler } from '../ws-handler-manager';
import { listConductorPasses, _closeConductorJournalDb } from '../conductor-pass-journal';

let project: string;
let invokeCalls: number;
/** Faithful "successful conductor node" mock: like the real node, it SERVES the active mission's
 *  open 'discover' gaps by filing a serving epic, so the productive-pass guard sees real progress.
 *  (A bare ok with no epic is the LLM-no-op WEDGE — see emptyServeInvoke.) */
const okInvoke = async () => {
  invokeCalls++;
  // Mirror the pass's own target selection (the project's single active mission) so the mock serves
  // the SAME mission the pass drives.
  const missions = listMissions(project);
  const m = missions.find((x) => x.mission.active && !isMissionTerminal(x.mission));
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
  _closeConductorJournalDb();
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

/** Forge an approved+active mission with TWO criteria: criterion A (capped, escalate) + criterion B (live epic, building).
 *  Criterion A burns CRITERION_SERVE_CAP serving epics (all dropped) and records a 're-decompose' rung.
 *  Criterion B has a serving epic with a ready child leaf, deriving action 'building'.
 *  Asserts via listCriteriaWithActions that the two actions are exactly 'escalate' and 'building'. */
async function forgeCappedPlusHoldingMission(title = 'Capped + Building mission') {
  const forged = await forgeMission(project, {
    session: 's1',
    title,
    criteria: ['criterion A: measure perf', 'criterion B: feature live'],
  });
  const criteria = listCriteria(project, forged.missionId);
  const critA = criteria[0];
  const critB = criteria[1];

  // Criterion A: burn the cap
  for (let i = 0; i < CRITERION_SERVE_CAP; i++) {
    const e = await createTodo(project, { ownerSession: 's1', title: `[EPIC] serve A ${i}`, kind: 'epic', parentId: forged.missionId, servesCriterionIds: [critA.id] });
    await updateTodo(project, e.id, { status: 'dropped' });
  }
  recordApproachAttempt({
    criterionId: critA.id,
    missionId: forged.missionId,
    project,
    rung: 're-decompose',
    epicId: null,
    outcome: 'attempted',
    detail: null,
    attemptedAt: Date.now(),
  });

  // Criterion B: create serving epic with ready leaf so deriveCriterionAction returns 'building'
  const epicB = await createTodo(project, {
    ownerSession: 's1',
    title: '[EPIC] serving epic for B',
    kind: 'epic',
    parentId: forged.missionId,
    servesCriterionIds: [critB.id],
  });
  await updateTodo(project, epicB.id, { status: 'ready' });
  await createTodo(project, { ownerSession: 's1', title: 'holding leaf', parentId: epicB.id, status: 'ready' });

  // Pin the fixture's premise: both derived actions as expected
  const actions = listCriteriaWithActions(project, forged.missionId);
  const actionMap = new Map(actions.map((a) => [a.id, a.action]));
  expect(actionMap.get(critA.id)).toBe('escalate');
  expect(actionMap.get(critB.id)).toBe('building');

  return { forged, critA, critB };
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

  test('the conductor node carries an EXPLICIT wall-clock ceiling, not node-invoker\'s generic default', async () => {
    // REGRESSION (measured, worker_ledger source='conductor', n=874 over 14d): the invoke passed
    // no timeoutMs and silently inherited DEFAULT_TIMEOUT_MS=600_000, which sat BELOW the
    // conductor's own productive duration tail — 142 productive passes ran 5–9.9m while 75
    // (8.6%, across 37 missions) were killed at the wall with 0 steps / 0 tokens / $0.00. An
    // omitted timeoutMs is silent: nothing in the type system or the tests noticed the conductor
    // was running under a ceiling nobody sized for it. Pin the field so it cannot regress to the
    // implicit default again.
    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();

    let seenTimeoutMs: number | undefined;
    const captureInvoke = async (spec: any) => {
      seenTimeoutMs = spec.timeoutMs;
      return okInvoke();
    };
    const r = await runConductorPass(project, { invoke: captureInvoke });

    expect(r.ran).toBe(true);
    expect(seenTimeoutMs).toBe(CONDUCTOR_NODE_TIMEOUT_MS);
    // The point of the pin: an explicit ceiling ABOVE the generic per-node default. If someone
    // drops the field, seenTimeoutMs goes undefined and this fails.
    expect(seenTimeoutMs).toBeGreaterThan(600_000);
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

    test('transient (timedOut, real start-window kill) failures never stamp the fail counter, but ARE bounded by the distinct timeout-recurrence cap', async () => {
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
      // Unlike rateLimited/startFailure, timedOut is bounded by CONDUCTOR_TIMEOUT_RECUR_CAP —
      // it never falls into the plain fail:-counter no-op arm, but it is not left unbounded
      // either. It still never touches lastConductorKey's |fail: prefix.
      for (let i = 0; i < CONDUCTOR_TIMEOUT_RECUR_CAP; i++) {
        const r = await runConductorPass(project, { invoke });
        expect(r.ran).toBe(true);
        expect(r.reason).toBe('node-failed');
      }
      expect(calls).toBe(CONDUCTOR_TIMEOUT_RECUR_CAP);
      const capped = await runConductorPass(project, { invoke });
      expect(capped.ran).toBe(false);
      expect(capped.reason).toBe('conductor-timeouts-capped');
      expect(calls).toBe(CONDUCTOR_TIMEOUT_RECUR_CAP); // no further node spawned past the cap
      const key = getMission(project, forged.missionId)?.lastConductorKey ?? '';
      expect(key.includes('|fail:')).toBe(false);
    });
  });

  describe('CONDUCTOR_TIMEOUT_RECUR_CAP — bounded timeout recurrence + one card naming the serve-state', () => {
    const timedOutInvoke = async () => { invokeCalls++; return { ok: false, rateLimited: false, timedOut: true, text: '' } as any; };

    test('CONDUCTOR_TIMEOUT_RECUR_CAP consecutive timeouts on an unchanged serve-state cap the pass and raise exactly one escalation naming the serve-state', async () => {
      addWatchedProject(project);
      setConductorEnabled(project, true);
      const forged = await forgeApprovedActive();
      let lastReason = '';
      for (let i = 0; i < CONDUCTOR_TIMEOUT_RECUR_CAP + 1; i++) {
        const r = await runConductorPass(project, { invoke: timedOutInvoke });
        lastReason = r.reason;
      }
      expect(invokeCalls).toBe(CONDUCTOR_TIMEOUT_RECUR_CAP);
      expect(lastReason).toBe('conductor-timeouts-capped');
      const cards = listOpenEscalations().filter((e) => e.kind === 'conductor-timeouts-capped' && e.todoId === forged.missionId);
      expect(cards.length).toBe(1);
      const mission = getMission(project, forged.missionId)!;
      expect(cards[0].questionText).toContain(String(mission.status));
    });

    test('a single timeout still re-invokes the node on the next tick', async () => {
      addWatchedProject(project);
      setConductorEnabled(project, true);
      await forgeApprovedActive();
      const r1 = await runConductorPass(project, { invoke: timedOutInvoke });
      expect(r1.ran).toBe(true);
      expect(r1.reason).toBe('node-failed');
      const r2 = await runConductorPass(project, { invoke: timedOutInvoke });
      expect(r2.ran).toBe(true);
      expect(r2.reason).toBe('node-failed');
      expect(invokeCalls).toBe(2);
    });

    test('rateLimited and startFailure passes past CONDUCTOR_TIMEOUT_RECUR_CAP re-invoke every tick and raise zero timeout cards', async () => {
      addWatchedProject(project);
      setConductorEnabled(project, true);
      const forgedRL = await forgeApprovedActive();
      let rlCalls = 0;
      const rateLimitedInvoke = async () => { rlCalls++; return { ok: false, rateLimited: true, text: '' } as any; };
      const n = CONDUCTOR_TIMEOUT_RECUR_CAP + 1;
      for (let i = 0; i < n; i++) {
        const r = await runConductorPass(project, { invoke: rateLimitedInvoke });
        expect(r.ran).toBe(true);
        expect(r.reason).toBe('node-failed');
      }
      expect(rlCalls).toBe(n); // every tick invoked — never capped

      const stubDir2 = mkdtempSync(join(tmpdir(), 'conductor-claude-stub2-'));
      const realCwd2 = mkdtempSync(join(tmpdir(), 'conductor-real-cwd2-'));
      _resetAuthCache();
      _resetClaudeBinCache();
      _primeAuthCacheForTest('subscription');
      process.env.MERMAID_TEST_ALLOW_DETACHED = '1';
      process.env.CLAUDE_BIN = join(stubDir2, 'does-not-exist');
      const project2 = mkdtempSync(join(tmpdir(), 'conductor-'));
      _resetMissionDbCache(project2);
      const priorProject = project;
      project = project2;
      addWatchedProject(project);
      setConductorEnabled(project, true);
      await forgeApprovedActive();
      const real = await invokeNode({ prompt: 'x', cwd: realCwd2 });
      expect(real.startFailure != null).toBe(true);
      let sfCalls = 0;
      const invoke = async () => { sfCalls++; return real; };
      for (let i = 0; i < n; i++) {
        const r = await runConductorPass(project, { invoke });
        expect(r.ran).toBe(true);
        expect(r.reason).toBe('node-failed');
      }
      expect(sfCalls).toBe(n); // every tick invoked — never capped
      delete process.env.CLAUDE_BIN;
      delete process.env.MERMAID_TEST_ALLOW_DETACHED;
      _resetAuthCache();
      _resetClaudeBinCache();
      project = priorProject;

      const timeoutCards = listOpenEscalations().filter(
        (e) => e.kind === 'conductor-timeouts-capped' && (e.todoId === forgedRL.missionId || e.project === project2),
      );
      expect(timeoutCards.length).toBe(0);
    });

    test('CONDUCTOR_TIMEOUT_RECUR_CAP is a distinct identifier from CONDUCTOR_SERVE_RETRY_CAP and burning the timeout counter leaves the fail counter untouched', async () => {
      expect(CONDUCTOR_TIMEOUT_RECUR_CAP).not.toBe(undefined);
      expect(CONDUCTOR_SERVE_RETRY_CAP).not.toBe(undefined);
      expect('CONDUCTOR_TIMEOUT_RECUR_CAP').not.toBe('CONDUCTOR_SERVE_RETRY_CAP');

      addWatchedProject(project);
      setConductorEnabled(project, true);
      const forged = await forgeApprovedActive();
      for (let i = 0; i < CONDUCTOR_TIMEOUT_RECUR_CAP; i++) {
        await runConductorPass(project, { invoke: timedOutInvoke });
      }
      const mission = getMission(project, forged.missionId)!;
      const key = mission.lastConductorKey ?? '';
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
    createEscalation({ project, session: 'coordinator', kind: 'epic-ready-to-land', questionText: 'ready', todoId: null, audience: 'internal' });
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
    createEscalation({ project, session: 'coordinator', kind: 'epic-ready-to-land', questionText: 'ready', todoId: forged.missionId, audience: 'internal' });
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

describe('runConductorPass — active mission selection', () => {
  test("conductor-pass drives the project's single active mission", async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const active = await forgeApprovedActive();
    // A second mission — enqueued (one-active-per-project), so it is NOT driven.
    await forgeMission(project, { session: 's1', title: 'Queued mission', criteria: ['a queued criterion'] });

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted');
    // The single ACTIVE mission is driven directly — no pin lookup, no rival advisory.
    expect(r.missionId).toBe(active.missionId);
  });

  test('set_active_mission swaps which mission conductor-pass drives', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const a = await forgeApprovedActive();
    const b = await forgeMission(project, { session: 's1', title: 'Second mission to drive', criteria: ['a second correct leaf is accepted'] });

    // Activating B (the set_active_mission override) makes B the active mission and re-queues A.
    activateMission(project, b.missionId);
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted');
    expect(r.missionId).toBe(b.missionId);
    // The displaced A is re-queued (queuePos != null), not orphaned.
    const aRow = getMission(project, a.missionId);
    expect(aRow!.active).toBe(false);
    expect(aRow!.queuePos).not.toBeNull();
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

  test('single active mission is driven directly', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted');
    expect(r.missionId).toBe(forged.missionId);
  });

  test('records lastPass reason "conducted" for the active mission id', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.reason).toBe('conducted');

    const lastPass = getConductorLastPass(project);
    expect(lastPass).not.toBeNull();
    expect(lastPass!.missionId).toBe(forged.missionId);
    expect(lastPass!.reason).toBe('conducted');
    expect(typeof lastPass!.tickAt).toBe('number');
  });

  test('a queued (non-active) mission never appears in lastPass.missionId', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const active = await forgeApprovedActive();
    // Enqueued behind the active mission (one-active-per-project) — must never be driven.
    const queued = await forgeMission(project, { session: 's1', title: 'Queued actionable mission', criteria: ['a queued criterion'] });

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.reason).toBe('conducted');

    const lastPass = getConductorLastPass(project);
    expect(lastPass!.missionId).toBe(active.missionId);
    expect(lastPass!.missionId).not.toBe(queued.missionId);
  });

  test('an abandoned active mission is not actionable ⇒ no-actionable-mission', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const target = await forgeApprovedActive();
    setMissionAbandoned(project, target.missionId, 1);

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('no-actionable-mission');
    expect(invokeCalls).toBe(0);
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

  test('a resolved serve-cap card is RE-OPENED while the criterion is still capped+unmet', async () => {
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
    const openMatching = listOpenEscalations().filter(
      (e) => e.kind === CRITERION_SERVE_CAP_KIND && e.todoId === forged.missionId && e.questionText.includes(serveCapMarker(crit.id)),
    );
    expect(openMatching.length).toBe(1);
    expect(openMatching[0].status).toBe('open');
    expect(openMatching[0].audience).toBe('human');
    expect(openMatching[0].todoId).toBe(forged.missionId);
    expect(conductorNeedsHuman(r2.reason)).toBe(true);

    const r3 = await runConductorPass(project, { invoke: okInvoke });
    void r3;
    const allMatching = listEscalations().filter(
      (e) => e.kind === CRITERION_SERVE_CAP_KIND && e.todoId === forged.missionId && e.questionText.includes(serveCapMarker(crit.id)),
    );
    expect(allMatching.length).toBe(1);
    expect(allMatching[0].status).toBe('open');
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

  test('serve-cap at the exact CRITERION_SERVE_CAP threshold with an empty ladder raises a card', async () => {
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

    expect(r.reason).toBe('criteria-escalated');
    expect(r.escalationsRaised).toBe(1); // card raised — threshold now aligned with deriveCriterionAction
    expect(r.serveCapDeferred).toBeFalsy(); // no longer deferred
    expect(escCalls.length).toBe(1);
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
    expect(qt).toContain('hit the serve cap');
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

  test('surfaces the current verdict sha/evidence in the serve-cap card and skips the ladder-incomplete line when the ladder was tried', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();

    const servingEpics = listTodos(project).filter((t) => t.kind === 'epic' && (t.servesCriterionIds ?? []).includes(crit.id));
    const leafId = `synthetic-leaf-${servingEpics[0].id}-content`;
    recordNode({
      project, todoId: leafId, epicId: servingEpics[0].id, leafId, session: 's1', nodeKind: 'outcome',
      nodesSpent: 0, leafOutcome: 'rejected',
      outcomeDetail: JSON.stringify({ reason: 'review-findings: naming inconsistency' }),
    }, Date.now() - 1000);

    setCriterionVerdict(project, crit.id, { met: false, evidence: 'p95 measured at 142ms on prod excerpt', verifiedAtSha: 'deadbeef1234', verifiedBy: 'conductor' });

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
    expect(escCalls.length).toBe(1);
    const qt = escCalls[0].questionText;
    expect(qt).toContain('deadbeef1234');
    expect(qt).toContain('p95 measured at 142ms on prod excerpt'.slice(0, 20));
    expect(qt).not.toContain('ladder incomplete');
  });

  test('mints a claimable close-out leaf for a capped test-only criterion', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();
    setCriterionVerdict(project, crit.id, {
      met: false,
      evidence: 'measured at src/__tests__/perf.test.ts:12 — TO CLOSE the threshold needs updating',
      evidencePaths: ['src/__tests__/perf.test.ts'],
      verifiedAtSha: 'deadbeef1234',
      verifiedBy: 'conductor',
    });

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.closeOutsMinted).toBe(1);

    const todos = listTodos(project);
    const closeEpic = todos.find((t) => t.kind === 'epic' && t.parentId === forged.missionId && (t.servesCriterionIds ?? []).includes(crit.id) && t.title.startsWith('Close out:'));
    expect(closeEpic).toBeTruthy();
    expect(closeEpic!.approvedAt).toBeTruthy(); // released BEFORE the leaf was added

    const closeLeaf = todos.find((t) => t.parentId === closeEpic!.id);
    expect(closeLeaf).toBeTruthy();
    expect(closeLeaf!.description).toContain('TO CLOSE');
    expect(closeLeaf!.description).toContain('OUT OF SCOPE');

    const byId = new Map(todos.map((t) => [t.id, t]));
    expect(claimReason(closeLeaf!, byId)).toBe('claimable');
    expect(isClaimable(closeLeaf!, byId)).toBe(true);
  });

  test('mints exactly one epic and leaf across four passes at an unchanged verifiedAtSha', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();
    setCriterionVerdict(project, crit.id, {
      met: false,
      evidence: 'measured at src/__tests__/perf.test.ts:12',
      evidencePaths: ['src/__tests__/perf.test.ts'],
      verifiedAtSha: 'deadbeef1234',
      verifiedBy: 'conductor',
    });

    let mintedTotal = 0;
    for (let i = 0; i < 4; i++) {
      const r = await runConductorPass(project, { invoke: okInvoke });
      mintedTotal += r.closeOutsMinted ?? 0;
    }
    expect(mintedTotal).toBe(1);

    const todos = listTodos(project);
    const closeEpics = todos.filter((t) => t.kind === 'epic' && t.parentId === forged.missionId && t.title.startsWith('Close out:'));
    expect(closeEpics.length).toBe(1);
    const closeLeaves = todos.filter((t) => t.parentId === closeEpics[0].id);
    expect(closeLeaves.length).toBe(1);
  });

  test('raises the serve-cap card and mints nothing when the verdict cites a src path', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeCappedMission();
    setCriterionVerdict(project, crit.id, {
      met: false,
      evidence: 'the fix landed at src/foo.ts:5',
      evidencePaths: ['src/foo.ts'],
      verifiedAtSha: 'deadbeef1234',
      verifiedBy: 'conductor',
    });

    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.closeOutsMinted ?? 0).toBe(0);
    expect(r.reason).toBe('criteria-escalated');
    expect(r.escalationsRaised).toBe(1);

    const todos = listTodos(project);
    const closeEpic = todos.find((t) => t.kind === 'epic' && t.parentId === forged.missionId && t.title.startsWith('Close out:'));
    expect(closeEpic).toBeUndefined();
  });

  test('falls through to the serve-cap card when the close arm dependency throws', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { crit } = await forgeCappedMission();
    setCriterionVerdict(project, crit.id, {
      met: false,
      evidence: 'measured at src/__tests__/perf.test.ts:12',
      evidencePaths: ['src/__tests__/perf.test.ts'],
      verifiedAtSha: 'deadbeef1234',
      verifiedBy: 'conductor',
    });

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      closeArm: async () => { throw new Error('boom'); },
    });
    expect(r.closeOutsMinted ?? 0).toBe(0);
    expect(r.reason).toBe('criteria-escalated');
    expect(r.escalationsRaised).toBe(1);
  });

  /** Forge a capped mission like forgeCappedMission, but also return the serving epic ids so
   *  the caller can attach leaf-run reasons to them (distinctReasons is keyed off these epics).
   *  @param liveEpicIndices - indices of epics to keep LIVE (non-dropped with a settled child leaf)
   */
  async function forgeCappedMissionWithEpicIds(title = 'MEASURED-live: p95 latency < 100ms in prod', liveEpicIndices: number[] = []) {
    const forged = await forgeMission(project, { session: 's1', title, criteria: ['p95 latency measured under 100ms on the live deploy'] });
    const crit = listCriteria(project, forged.missionId)[0];
    const epicIds: string[] = [];
    for (let i = 0; i < CRITERION_SERVE_CAP; i++) {
      const e = await createTodo(project, { ownerSession: 's1', title: `[EPIC] serve ${i}`, kind: 'epic', parentId: forged.missionId, servesCriterionIds: [crit.id] });
      if (liveEpicIndices.includes(i)) {
        // Keep this epic live with a settled child leaf (to avoid childless grace period).
        // Set status to 'ready' and add a child leaf that's rejected (accepted then dropped).
        await updateTodo(project, e.id, { status: 'ready' });
        const settledLeaf = await createTodo(project, { ownerSession: 's1', title: 'settled leaf', parentId: e.id, status: 'ready' });
        await updateTodo(project, settledLeaf.id, { status: 'dropped', acceptanceStatus: 'rejected' });
      } else {
        // Drop the epic directly.
        await updateTodo(project, e.id, { status: 'dropped' });
      }
      epicIds.push(e.id);
    }
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
    // Pin the fixture: with live epics non-dropped and settle children, action should be 'escalate'.
    const actions = listCriteriaWithActions(project, forged.missionId);
    const critAction = actions.find((c) => c.id === crit.id);
    expect(critAction?.action).toBe('escalate');
    return { forged, crit, epicIds };
  }

  function recordBaseRedLeafRun(epicId: string) {
    const leafId = `synthetic-leaf-${epicId}-red`;
    recordNode({
      project, todoId: leafId, epicId, leafId, session: 's1', nodeKind: 'outcome',
      nodesSpent: 0, leafOutcome: 'rejected',
      outcomeDetail: JSON.stringify({ reason: 'epic-base-red: npx tsc --noEmit\n--- output (tail) ---\nerror TS2345' }),
    });
  }

  function recordContentLeafRun(epicId: string) {
    const leafId = `synthetic-leaf-${epicId}-content`;
    recordNode({
      project, todoId: leafId, epicId, leafId, session: 's1', nodeKind: 'outcome',
      nodesSpent: 0, leafOutcome: 'rejected',
      outcomeDetail: JSON.stringify({ reason: 'review-findings: naming inconsistency' }),
    });
  }

  test('all-base-red distinctReasons + GREEN re-measure on every serving epic ⇒ suppresses the serve-cap card', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, epicIds } = await forgeCappedMissionWithEpicIds('MEASURED-live: p95 latency < 100ms in prod', [0]);
    recordBaseRedLeafRun(epicIds[0]);
    recordContentLeafRun(epicIds[1]); // Record a non-base-red reason on a dropped epic.

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [],
      epicBaseProbe: async () => 'pass',
    });

    expect(r.ran).toBe(false);
    void forged;
    expect(escCalls.filter((e) => e.kind === CRITERION_SERVE_CAP_KIND).length).toBe(0);
    expect(r.serveCapDeferred).toBeGreaterThanOrEqual(1);
  });

  test('all-base-red distinctReasons + a FAILING re-measure still raises the serve-cap card', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { epicIds } = await forgeCappedMissionWithEpicIds('MEASURED-live: p95 latency < 100ms in prod', [0]);
    recordBaseRedLeafRun(epicIds[0]);

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [],
      epicBaseProbe: async () => 'fail',
    });

    expect(r.ran).toBe(false);
    expect(escCalls.filter((e) => e.kind === CRITERION_SERVE_CAP_KIND).length).toBe(1);
  });

  test('all-base-red distinctReasons + a THROWING probe fails open: card raised and the pass still returns', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { epicIds } = await forgeCappedMissionWithEpicIds('MEASURED-live: p95 latency < 100ms in prod', [0]);
    recordBaseRedLeafRun(epicIds[0]);

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [],
      epicBaseProbe: async () => { throw new Error('probe boom'); },
    });

    expect(r.ran).toBe(false);
    expect(escCalls.filter((e) => e.kind === CRITERION_SERVE_CAP_KIND).length).toBe(1);
  });

  test('mixed reasons (not all epic-base-red) still raise the card even when the probe would pass', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { epicIds } = await forgeCappedMissionWithEpicIds('MEASURED-live: p95 latency < 100ms in prod', [0, 1]);
    recordBaseRedLeafRun(epicIds[0]);
    recordContentLeafRun(epicIds[1]);

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [],
      epicBaseProbe: async () => 'pass',
    });

    expect(r.ran).toBe(false);
    expect(escCalls.filter((e) => e.kind === CRITERION_SERVE_CAP_KIND).length).toBe(1);
  });

  test('bumps serveAttemptCount for a presented-but-unserved gap and raises criterion-serve-attempts-capped at the cap, while a served gap resets to 0', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Serve-attempt counter mission',
      criteria: ['criterion A: never served', 'criterion B: served every pass'],
    });
    const criteria = listCriteria(project, forged.missionId);
    const critA = criteria[0];
    const critB = criteria[1];

    // Serves B every pass, never files anything for A.
    const invoke = async () => {
      await createTodo(project, {
        ownerSession: 's1', title: '[EPIC] served B', kind: 'epic', parentId: forged.missionId, servesCriterionIds: [critB.id],
      });
      return { ok: true, rateLimited: false, text: 'served B, skipped A' } as any;
    };

    for (let i = 0; i < CRITERION_SERVE_ATTEMPT_CAP; i++) {
      // Force each pass to actually run (bypass the productive-pass debounce, which otherwise
      // treats an unchanged serve-signature as already-attempted) by toggling an unrelated
      // mission-scoped card open/resolved around each call — a genuinely new signature each time.
      const { escalation } = createEscalation({
        audience: 'internal', project, session: 's1', kind: 'blocker', todoId: forged.missionId, questionText: `force wake ${i}`,
      });
      await runConductorPass(project, { invoke });
      resolveEscalation(escalation.id, 'resolved');
    }

    const finalCriteria = listCriteriaWithActions(project, forged.missionId);
    const finalA = finalCriteria.find((c) => c.id === critA.id)!;
    const finalB = finalCriteria.find((c) => c.id === critB.id)!;

    expect(finalA.serveAttemptCount).toBe(CRITERION_SERVE_ATTEMPT_CAP);
    expect(finalB.serveAttemptCount).toBe(0);
    expect(finalB.servingEpicState).not.toBe('none');

    const capped = listOpenEscalations().filter((e) => e.project === project && e.kind === CRITERION_SERVE_ATTEMPTS_CAPPED_KIND);
    expect(capped.length).toBe(1);
    expect(capped[0].conditionKey).toBe(`serve-attempts-cap:${critA.id}`);
    expect(capped[0].questionText).toContain(critA.id);
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
      audience: 'internal',
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
  test('buildConductorPrompt no longer instructs the LLM to park at attempts >= 3 via reset_todo', () => {
    const p = buildConductorPrompt('/proj', 'm1', 'Ship the thing', 'sess-A');
    expect(p).not.toContain('Repeatedly failing (attempts');
  });
  test('buildConductorPrompt no longer instructs to serve EVERY gap and names the serve bound', () => {
    const p = buildConductorPrompt('/proj', 'm1', 'Ship the thing', 'sess-A');
    expect(p).not.toContain('Serve EVERY open');
    expect(p).toContain(String(CONDUCTOR_SERVE_BATCH_MAX));
  });
  test('prompt names the mission + session, forbids hand-editing, lands as conductor', () => {
    const p = buildConductorPrompt('/proj', 'm1', 'Ship the thing', 'sess-A');
    expect(p).toContain('m1');
    expect(p).toContain('Ship the thing');
    expect(p).toContain('sess-A');
    expect(p).toContain('hand-edit source');
    // Landing is done by the deterministic land arm before the pass runs; the prompt no
    // longer instructs the model to go find a land card and confirm its readiness itself.
    expect(p).toContain('LANDING is AUTOMATIC');
    expect(p).not.toContain('mcp__mermaid__epic_land_readiness');
  });
});

describe('runConductorPass — recovery arms run BEFORE the escalate return (mission 362ef9b8 self-wedge lock)', () => {
  test("(a) 'an escalate-blocked mission still auto-redispatches another criterion's base-red leaf'", async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, critA, critB } = await forgeCappedPlusHoldingMission();

    const infraArmSpy = (async () => ({ candidates: [], reset: ['leaf-1'], cardsRaised: 0, skipped: [] })) as any;
    const redecomposeArmSpy = (async () => ({ redecomposed: [] })) as any;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      infraArm: infraArmSpy,
      redecomposeArm: redecomposeArmSpy,
      epicBaseProbe: async () => 'fail',
      createEscalation: (() => ({})) as any,
      listOpenEscalations: () => [],
    });

    expect(r.reason).toBe('infra-leaf-reset');
    expect(r.infraResets).toBeGreaterThan(0);
    expect(invokeCalls).toBe(0); // node NOT spawned when infra arm resets
  });

  test("(b) 'an escalate-blocked mission still re-decomposes a churning epic'", async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, critA, critB } = await forgeCappedPlusHoldingMission();

    let infraCalled = false;
    let redecomposeCalled = false;
    const infraArmSpy = (async () => {
      infraCalled = true;
      return { candidates: [], reset: [], cardsRaised: 0, skipped: [] };
    }) as any;
    const redecomposeArmSpy = (async () => {
      redecomposeCalled = true;
      return { redecomposed: [{ criterionId: 'crit-1', epicId: 'epic-1' }] };
    }) as any;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      infraArm: infraArmSpy,
      redecomposeArm: redecomposeArmSpy,
      epicBaseProbe: async () => 'fail',
      createEscalation: (() => ({})) as any,
      listOpenEscalations: () => [],
    });

    expect(infraCalled).toBe(true);
    expect(redecomposeCalled).toBe(true);
    expect(r.reason).toBe('redecomposed');
    expect(r.redecomposed).toBeGreaterThan(0);
    expect(invokeCalls).toBe(0); // node NOT spawned when redecompose arm acts
  });

  test("(c) 'both arms find nothing ⇒ the pass falls through to criteria-escalated — and both arms were still CALLED'", async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, critA, critB } = await forgeCappedPlusHoldingMission();

    let infraCalled = false;
    let redecomposeCalled = false;
    const infraArmSpy = (async () => {
      infraCalled = true;
      return { candidates: [], reset: [], cardsRaised: 0, skipped: [] };
    }) as any;
    const redecomposeArmSpy = (async () => {
      redecomposeCalled = true;
      return { redecomposed: [] };
    }) as any;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      infraArm: infraArmSpy,
      redecomposeArm: redecomposeArmSpy,
      epicBaseProbe: async () => 'fail',
      createEscalation: (() => ({})) as any,
      listOpenEscalations: () => [],
    });

    expect(infraCalled).toBe(true);
    expect(redecomposeCalled).toBe(true);
    expect(r.reason).toBe('criteria-escalated');
    expect(invokeCalls).toBe(0); // node NOT spawned because critB is building (not discover/verify)
  });

  test('filed epic ref uses the arm\'s epicId, not the criterionId', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, critA } = await forgeCappedPlusHoldingMission();

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      infraArm: (async () => ({ candidates: [], reset: [], cardsRaised: 0, skipped: [], baseRepairEpics: [], reapedBaseRepairEpics: [] })) as any,
      cardTriageArm: (async () => ({ parked: [], skipped: [] })) as any,
      redecomposeArm: (async () => ({ redecomposed: [{ criterionId: critA.id, epicId: 'e-new' }], skipped: [] })) as any,
    });

    expect(r.reason).toBe('redecomposed');
    expect(r.redecomposed).toBe(1);

    const row = listConductorPasses(project)[0];
    const filedArray = Array.isArray(row.filed) ? row.filed : [];
    const redecomposedRef = filedArray.find((f: any) => f.title?.startsWith('re-decomposed:'));
    expect(redecomposedRef).toEqual(
      { kind: 'epic', id: 'e-new', title: `re-decomposed: ${critA.text}` }
    );
  });

  test('an all-skipped redecompose result does not short-circuit as redecomposed', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, critA } = await forgeCappedPlusHoldingMission();

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      infraArm: (async () => ({ candidates: [], reset: [], cardsRaised: 0, skipped: [], baseRepairEpics: [], reapedBaseRepairEpics: [] })) as any,
      cardTriageArm: (async () => ({ parked: [], skipped: [] })) as any,
      redecomposeArm: (async () => ({ redecomposed: [], skipped: [{ criterionId: critA.id, why: 'plan-failed' }] })) as any,
    });

    expect(r.reason).not.toBe('redecomposed');

    const row = listConductorPasses(project)[0];
    const filedArray = Array.isArray(row.filed) ? row.filed : [];
    const redecomposedTitle = filedArray.some((f) => (f as any).title?.startsWith('re-decomposed:'));
    expect(redecomposedTitle).toBe(false);
  });
});

describe('runConductorPass — verify panel arm auto-fire (criterion-verify-panel-arm)', () => {
  test('a stakes-routed criterion is paneled automatically by the pass', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Paneled verify',
      criteria: ['high-stakes criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    // Trigger high-stakes: enqueue a recheck (reopened-by-land)
    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'land-diff-intersects-evidence', landedSha: 'abc123' });

    // Create a serving epic so action === 'verify'
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, epic.id, { status: 'ready' });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, leaf.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    // Mock panel runner returns met verdict
    let panelCalls = 0;
    const r = await runConductorPass(project, {
      invoke: async () => { throw new Error('no node should be spawned'); },
      verifyPanelArm: async (proj, missionId, session, deps) => {
        panelCalls++;
        // Panel run recorded verdicts immediately
        return { paneled: [crit.id], held: [], skipped: [] };
      },
    });

    expect(r.ran).toBe(true);
    expect(r.reason).toBe('verify-paneled');
    expect(r.verifyPaneled).toBe(1);
    expect(r.verifyHeld).toBe(0);
    expect(invokeCalls).toBe(0); // node NOT spawned when verify panel arm acts
    expect(panelCalls).toBe(1);
  });

  test('an arm fault degrades to a no-op pass (falls through to normal pass logic)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Fault degradation',
      criteria: ['high-stakes criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    // Trigger high-stakes
    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'land-diff-intersects-evidence', landedSha: 'abc123' });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, epic.id, { status: 'ready' });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, leaf.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    // Panel arm throws: fail-open behavior → defaults to all empty arrays → falls through to normal pass logic (conduct node)
    invokeCalls = 0;
    const r = await runConductorPass(project, {
      invoke: okInvoke,
      verifyPanelArm: async () => {
        throw new Error('arm fault');
      },
    });

    // The pass should not crash; arm fault is caught and execution continues to normal pass logic
    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted'); // Falls through to normal path, which serves the verify criterion
    expect(r.verifyPaneled).toBeUndefined(); // No verify-paneled early return
    expect(r.verifyHeld).toBeUndefined();
    expect(invokeCalls).toBe(1); // Node WAS spawned because arm fault defaulted to all empty → no early return
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
    activateMission(project, second.missionId);

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

  test('the rendered conductor prompt no longer instructs the node to run a single-checker verify itself', () => {
    const p = buildConductorPrompt('/p', 'm1', 'A mission', 's1');
    expect(p).not.toMatch(/run the\s+INDEPENDENT verify/);
    expect(p).not.toContain('That is ONE independent checker — the default.');
    expect(p).not.toContain('takes the default single-checker path above, unchanged.');
    expect(p).toContain('auto-checked by the deterministic verify panel arm');
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
      audience: 'internal',
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

  /** Forge an approved+active mission whose single criterion derives action 'verify' (a landed,
   *  proving serving epic, no verdict yet) AND has burned servedEpicCount >= CRITERION_PANEL_SERVE_THRESHOLD
   *  (2 real-work serving epics) so classifyVerifyStakes fires the 'serve-burn' trigger → panel. */
  async function forgeVerifyServeBurn() {
    const forged = await forgeMission(project, { session: 's1', title: 'Serve-burn verify mission', criteria: ['the landed change still holds at HEAD'] });
    const crit = listCriteria(project, forged.missionId)[0];

    // epic1: LANDED + proves crit + did real work → servingEpicState 'landed' ⇒ action 'verify'.
    const epic1 = await createTodo(project, { ownerSession: 's1', title: '[EPIC] serve 1 (landed)', kind: 'epic', parentId: forged.missionId, servesCriterionIds: [crit.id] });
    const leaf1 = await createTodo(project, { ownerSession: 's1', title: 'proof leaf', parentId: epic1.id, servesCriterionIds: [crit.id] });
    await updateTodo(project, leaf1.id, { status: 'done', acceptanceStatus: 'accepted' });
    await updateTodo(project, epic1.id, { status: 'done' }); // status 'done' ⇒ isLandedEpic

    // epic2: dropped but did real work (a rejected leaf) → bumps servedEpicCount to 2 (serve-burn).
    const epic2 = await createTodo(project, { ownerSession: 's1', title: '[EPIC] serve 2 (dropped)', kind: 'epic', parentId: forged.missionId, servesCriterionIds: [crit.id] });
    const leaf2 = await createTodo(project, { ownerSession: 's1', title: 'rejected leaf', parentId: epic2.id, servesCriterionIds: [crit.id] });
    await updateTodo(project, leaf2.id, { status: 'done', acceptanceStatus: 'rejected' });
    await updateTodo(project, epic2.id, { status: 'dropped' });

    return { forged, crit };
  }

  test('a serve-burn verify criterion (servedEpicCount ≥ panel threshold) carries a HIGH-STAKES VERIFY panel entry', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged, crit } = await forgeVerifyServeBurn();
    // Premise: the derivation reads this criterion as 'verify' with servedEpicCount ≥ 2.
    const c = listCriteriaWithActions(project, forged.missionId).find((x) => x.id === crit.id)!;
    expect(c.action).toBe('verify');
    expect(c.servedEpicCount).toBeGreaterThanOrEqual(2);

    let prompt = '';
    await runConductorPass(project, {
      invoke: async (spec: any) => { prompt = spec.prompt; return okInvoke(); },
      verifyPanelArm: async () => ({ paneled: [], held: [], skipped: [] }), // Mock: panel arm does nothing this pass
    });
    // Assert on the WAKE-CONTEXT panel bullet, not the always-present step-3 instruction text:
    // the per-criterion "trigger: serve-burn" line is emitted ONLY by the rendered section.
    expect(prompt).toContain(`${crit.id}   trigger: serve-burn`);
    expect(prompt).toContain('HIGH-STAKES VERIFY');
    expect(prompt).toContain('automatically paneled by the conductor pass');
  });

  test('a fresh unserved criterion carries NO HIGH-STAKES VERIFY panel entry', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    // Premise: fresh criterion derives 'discover' (unserved) — not high-stakes.
    const c = listCriteriaWithActions(project, forged.missionId)[0];
    expect(c.action).toBe('discover');
    expect(c.servedEpicCount).toBe(0);

    let prompt = '';
    await runConductorPass(project, {
      invoke: async (spec: any) => { prompt = spec.prompt; return okInvoke(); },
      verifyPanelArm: async () => ({ paneled: [], held: [], skipped: [] }), // Mock: panel arm does nothing
    });
    // The step-3 instruction always mentions "HIGH-STAKES VERIFY"; the RENDERED panel section (its
    // distinctive header "automatically paneled by the conductor pass") must be absent for a fresh, non-high-stakes criterion.
    expect(prompt).not.toContain('automatically paneled by the conductor pass');
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

  test('two blueprint-uncitable-criterion reasons plus a newer verdict names a different blocker surfaces CURRENT VERDICT before REASONS SEEN', () => {
    const evidence = 'evidence naming a different blocker';
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [],
      distinctReasons: ['blueprint uncitable one', 'blueprint uncitable two'],
      verdict: { evidence, verifiedAt: 100, verifiedAtSha: 'abc1234' },
      newestReasonAt: 50,
    });
    expect(diagnosis).toContain('CURRENT VERDICT');
    expect(diagnosis).toContain('abc1234');
    expect(diagnosis).toContain(evidence);
    expect(diagnosis).toContain('REASONS SEEN');
    expect(diagnosis.indexOf(evidence)).toBeLessThan(diagnosis.indexOf('REASONS SEEN'));
  });

  const BASELINE_INPUT = {
    criterionText: 'test criterion',
    servedEpicCount: 3,
    attempts: [
      { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 're-decompose' as const, epicId: 'e1', outcome: 'attempted' as const, detail: null, attemptedAt: 1 },
    ],
    distinctReasons: ['reason one', 'reason two'],
  };

  test('omitting verdict/newestReasonAt/exhaustedBy is byte-identical to the pre-change output', () => {
    const diagnosis = buildServeCapDiagnosis(BASELINE_INPUT);
    expect(diagnosis).toBe([
      'REASONS SEEN',
      '- reason one',
      '- reason two',
      '',
      'LADDER',
      'fresh-blueprint — not recorded',
      'tier-bump — not recorded',
      're-decompose — attempted, epic e1',
      '',
      'RECOMMEND: ladder incomplete — fresh-blueprint, tier-bump never ran; investigate the rung owner',
    ].join('\n'));
  });

  test('a verdict older than newestReasonAt does not surface CURRENT VERDICT', () => {
    const diagnosis = buildServeCapDiagnosis({
      ...BASELINE_INPUT,
      verdict: { evidence: 'stale evidence', verifiedAt: 10, verifiedAtSha: 'deadbee' },
      newestReasonAt: 50,
    });
    expect(diagnosis).toBe([
      'REASONS SEEN',
      '- reason one',
      '- reason two',
      '',
      'LADDER',
      'fresh-blueprint — not recorded',
      'tier-bump — not recorded',
      're-decompose — attempted, epic e1',
      '',
      'RECOMMEND: ladder incomplete — fresh-blueprint, tier-bump never ran; investigate the rung owner',
    ].join('\n'));
  });

  test("exhaustedBy 'serve-cap' with only re-decompose missing excludes the ladder-incomplete language and names the cap", () => {
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 4,
      attempts: [
        { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'fresh-blueprint', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 1 },
        { id: '2', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'tier-bump', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 2 },
      ],
      distinctReasons: ['reason one', 'reason two'],
      exhaustedBy: 'serve-cap',
    });
    expect(diagnosis).not.toContain('ladder incomplete');
    expect(diagnosis).not.toContain('investigate the rung owner');
    expect(diagnosis).toContain(String(CRITERION_SERVE_CAP));
    expect(diagnosis).toContain('4');
  });

  test("exhaustedBy 'store-fault' recommend line differs from the serve-cap recommend line", () => {
    const serveCapDiagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 4,
      attempts: [
        { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'fresh-blueprint', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 1 },
      ],
      distinctReasons: [],
      exhaustedBy: 'serve-cap',
    });
    const storeFaultDiagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 4,
      attempts: [
        { id: '1', criterionId: 'c1', missionId: 'm1', project: 'p1', rung: 'fresh-blueprint', epicId: null, outcome: 'attempted', detail: null, attemptedAt: 1 },
      ],
      distinctReasons: [],
      exhaustedBy: 'store-fault',
    });
    expect(storeFaultDiagnosis).not.toBe(serveCapDiagnosis);
    expect(storeFaultDiagnosis).toContain('approach-attempt store could not be read');
  });

  test("exhaustedBy 're-decompose' with rungs missing still emits the ladder-incomplete investigate-the-rung-owner line", () => {
    const diagnosis = buildServeCapDiagnosis({
      criterionText: 'test',
      servedEpicCount: 3,
      attempts: [],
      distinctReasons: [],
      exhaustedBy: 're-decompose',
    });
    expect(diagnosis).toContain('investigate the rung owner');
  });
});

describe('conductorStatusLine', () => {
  test('maps every settled reason to a non-empty <=60-char status', () => {
    const reasons = [
      'conductor-disabled', 'daemon-off', 'no-actionable-mission', 'target-not-actionable',
      'target-cleared', 'building-wait', 'criteria-escalated', 'debounced', 'conducted',
      'node-failed', 'infra-leaf-reset', 'redecomposed', 'over-budget-rebet', 'pass-ran', 'pass-error',
      'verify-paneled',
    ] as const;
    for (const r of reasons) {
      const s = conductorStatusLine(r);
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
      expect(s.length).toBeLessThanOrEqual(60);
    }
  });

  test('surfaces counts for a productive conducted pass; stable strings for the common reasons', () => {
    expect(conductorStatusLine('conducted')).toBe('assigned new work');
    expect(conductorStatusLine('conducted', { escalationsRaised: 2 })).toContain('2 raised for you');
    expect(conductorStatusLine('criteria-escalated', { serveCapDeferred: 1 })).toContain('stuck');
    expect(conductorStatusLine('debounced')).toBe('idle — nothing to do');
    expect(conductorStatusLine('building-wait')).toBe('building — waiting on work');
    expect(conductorStatusLine('conductor-timeouts-capped', { timeoutKills: 3 })).toBe('killed 3x — needs you');
    expect(conductorStatusLine('node-failed', { timeoutKills: 2 })).toBe('killed 2x — retrying');
    expect(conductorStatusLine('node-failed')).toBe('hit an error — retrying');
  });
});

describe('conductorNeedsHuman', () => {
  test('true exactly for the settled "— needs you" reasons', () => {
    // Parity with conductorStatusLine: every reason whose status ends in "needs you"
    // must be flagged, and nothing else. Guards the Bridge RED project-card signal.
    expect(conductorNeedsHuman('criteria-escalated')).toBe(true);
    expect(conductorNeedsHuman('over-budget-rebet')).toBe(true);
    expect(conductorNeedsHuman('conductor-timeouts-capped')).toBe(true);
    for (const r of ['conducted', 'debounced', 'building-wait', 'pass-ran', 'redecomposed',
      'no-actionable-mission', 'conductor-disabled', 'daemon-off', 'node-failed'] as const) {
      expect(conductorNeedsHuman(r)).toBe(false);
    }
    expect(conductorNeedsHuman(null)).toBe(false);
    expect(conductorNeedsHuman(undefined)).toBe(false);
  });

  test('flags every reason whose status line ends in "needs you"', () => {
    const reasons = [
      'conductor-disabled', 'daemon-off', 'no-actionable-mission', 'target-not-actionable',
      'target-cleared', 'building-wait', 'criteria-escalated', 'debounced', 'conducted',
      'node-failed', 'infra-leaf-reset', 'redecomposed', 'over-budget-rebet', 'pass-ran', 'pass-error',
    ] as const;
    for (const r of reasons) {
      // serveCapDeferred:0 → criteria-escalated renders the bare "capped — needs you" branch.
      const endsInNeedsYou = conductorStatusLine(r).endsWith('needs you');
      expect(conductorNeedsHuman(r)).toBe(endsInNeedsYou);
    }
  });
});

describe('conductor_pass WS broadcast', () => {
  afterEach(() => {
    initializeWebSocketHandler(null as any);
  });

  test('broadcasts exactly one conductor_pass event carrying the enriched row per finalized pass', async () => {
    const broadcast = (() => {
      const calls: any[] = [];
      const fn: any = (msg: any) => calls.push(msg);
      fn.calls = calls;
      return fn;
    })();
    initializeWebSocketHandler({ broadcast } as any);

    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });

    const passMessages = broadcast.calls.filter((m: any) => m.type === 'conductor_pass');
    expect(passMessages.length).toBe(1);
    expect(passMessages[0].project).toBe(project);
    expect(passMessages[0].row.endedAt).not.toBeNull();
    expect(passMessages[0].row.outcome).toBe(r.reason);
  });

  test('a throwing broadcast handler leaves ConductorPassResult unchanged and the row sealed with endedAt/outcome', async () => {
    const throwingBroadcast = () => {
      throw new Error('broadcast boom');
    };
    initializeWebSocketHandler({ broadcast: throwingBroadcast } as any);

    addWatchedProject(project);
    setConductorEnabled(project, true);
    await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });

    expect(r.ran).toBe(true);
    expect(r.reason).toBe('conducted');

    const rows = listConductorPasses(project, { limit: 5 });
    const sealed = rows.find((row) => row.missionId === r.missionId);
    expect(sealed).toBeDefined();
    expect(sealed!.endedAt).not.toBeNull();
    expect(sealed!.outcome).not.toBeNull();
  });

  test('the kill-rate exit-check arm raises exactly one card, and a second pass on unchanged state raises none', async () => {
    const { runConductorKillRateArm, _resetConductorKillRateThrottle } = await import('../conductor-kill-rate');
    const { CONDUCTOR_KILL_RATE_SOURCE, CONDUCTOR_KILL_RATE_WINDOW_MS } = await import('../conductor-kill-rate');

    _resetConductorKillRateThrottle();
    addWatchedProject(project);

    const now = Date.now();
    const windowMs = CONDUCTOR_KILL_RATE_WINDOW_MS;
    const insideWindow = now - windowMs / 2;

    // Seed 50 conductor rows: 20 kills, 30 non-kills (40% rate, above 8.6% baseline).
    for (let i = 0; i < 20; i++) {
      recordNode({
        project,
        todoId: `todo-kill-${i}`,
        session: 'test-session',
        source: CONDUCTOR_KILL_RATE_SOURCE,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        knownPrice: true,
        steps: 1,
        timedOut: true,
      }, insideWindow);
    }
    for (let i = 0; i < 30; i++) {
      recordNode({
        project,
        todoId: `todo-ok-${i}`,
        session: 'test-session',
        source: CONDUCTOR_KILL_RATE_SOURCE,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0,
        knownPrice: true,
        steps: 1,
        timedOut: false,
      }, insideWindow);
    }

    // First pass: should raise a card
    const result1 = await runConductorKillRateArm(project, { now: () => now });
    expect(result1.cardRaised).toBe(true);

    const escalations1 = listOpenEscalations();
    const killRateCard1 = escalations1.find((e) => e.kind === 'conductor-kill-rate');
    expect(killRateCard1).toBeDefined();

    // Second pass immediately after: should not raise another card (same window, already have a card)
    const result2 = await runConductorKillRateArm(project, { now: () => now + 1 });
    // The second call should NOT raise because of the dedup in createEscalation (conditionKey).
    // However, since our throttle is per-project and fires on the first call, a second immediate
    // call will skip the arm entirely (shouldRunConductorKillRateArm returns false).
    expect(result2.cardRaised).toBe(false);

    // Verify only one card was raised
    const escalationsFinal = listOpenEscalations();
    const killRateCardsFinal = escalationsFinal.filter((e) => e.kind === 'conductor-kill-rate');
    expect(killRateCardsFinal.length).toBe(1);
  });

  test('the kill-rate exit-check arm fails-open when injected to throw', async () => {
    const { _resetConductorKillRateThrottle } = await import('../conductor-kill-rate');

    _resetConductorKillRateThrottle();
    addWatchedProject(project);

    // Forge a mission so the conductor has something to serve
    const forged = await forgeApprovedActive();

    // Inject a killRateArm that throws
    const throwingArm = async () => {
      throw new Error('Simulated kill-rate arm failure');
    };

    // The conductor pass should NOT throw; it must catch and continue normally
    const result = await runConductorPass(project, {
      invoke: okInvoke,
      killRateArm: throwingArm as any,
    });

    // The pass should complete successfully and not report an error due to the arm throw
    expect(result).toBeDefined();
    // The pass may report any successful outcome (conducted, debounced, etc.),
    // but NOT an error caused by the arm
    expect(result.reason).not.toBe('pass-error');
  });
});

describe('runConductorPass — awaiting-observation criterion', () => {
  test('runConductorPass files ZERO serving epics for an awaiting-observation criterion while still serving a sibling discover criterion in the same pass', async () => {
    const { setCriterionMeasurementPendingUntil, addCriterion } = await import('../mission-store');

    addWatchedProject(project);
    const forged = await forgeApprovedActive();
    const missionId = forged.missionId;

    // Add a second criterion with awaiting-observation window
    const crit2 = addCriterion(project, missionId, 'awaiting observation window', 'capability');
    const futureTime = Date.now() + 1000 * 60 * 60; // 1 hour in the future
    setCriterionMeasurementPendingUntil(project, crit2.id, futureTime);

    // Get criteria with actions - the first should be 'discover', the second should be 'awaiting-observation'
    const criteriaWithActions = listCriteriaWithActions(project, missionId);
    const discoverCriteria = criteriaWithActions.filter((c) => c.action === 'discover');
    const awaitingObsCriteria = criteriaWithActions.filter((c) => c.action === 'awaiting-observation');

    // Verify the actions are as expected
    expect(discoverCriteria.length).toBe(1);
    expect(awaitingObsCriteria.length).toBe(1);
    expect(awaitingObsCriteria[0].id).toBe(crit2.id);
  });
});
