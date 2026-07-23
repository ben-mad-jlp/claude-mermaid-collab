import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stable supervisor dir (watched_project + node_profile_override caches); per-test project dir keeps
// the mission/decision/todo stores fresh.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass, conductorFingerprint, buildConductorPrompt, CRITERION_SERVE_CAP_KIND, serveCapMarker, CONDUCTOR_SERVE_RETRY_CAP } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled, createEscalation, listOpenEscalations, listEscalations, acknowledgeEscalation, getConductorTargetMission, setConductorTargetMission, getConductorLastPass, type Escalation } from '../supervisor-store';
import { getMission, _resetMissionDbCache, setMissionAbandoned, setCriterionMet, CRITERION_SERVE_CAP, listMissions, listCriteriaWithActions, isMissionTerminal } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { planMissionCriterion } from '../../mcp/tools/mission-planner';
import { listCriteria } from '../mission-store';
import { createTodo, updateTodo } from '../todo-store';
import { setOrchestratorLevel } from '../orchestrator-config';

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
 *  serving epics (all dropped → no live serving epic) so it derives action 'escalate'. */
async function forgeCappedMission(title = 'MEASURED-live: p95 latency < 100ms in prod') {
  const forged = await forgeMission(project, { session: 's1', title, criteria: ['p95 latency measured under 100ms on the live deploy'] });
  const crit = listCriteria(project, forged.missionId)[0];
  for (let i = 0; i < CRITERION_SERVE_CAP; i++) {
    const e = await createTodo(project, { ownerSession: 's1', title: `[EPIC] serve ${i}`, kind: 'epic', parentId: forged.missionId, servesCriterionIds: [crit.id] });
    await updateTodo(project, e.id, { status: 'dropped' });
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

  test('transient (startFailure) failures also never stamp the fail counter or wedge the mission', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeApprovedActive();
    let startFailCalls = 0;
    const startFailureInvoke = async () => {
      startFailCalls++;
      return { ok: false, rateLimited: false, startFailure: { provider: 'x', model: 'y', detail: 'z' }, text: '' } as any;
    };
    const n = CONDUCTOR_SERVE_RETRY_CAP + 2;
    for (let i = 0; i < n; i++) {
      const r = await runConductorPass(project, { invoke: startFailureInvoke });
      expect(r.ran).toBe(true);
      expect(r.reason).toBe('node-failed');
    }
    expect(startFailCalls).toBe(n);
    const key = getMission(project, forged.missionId)?.lastConductorKey ?? '';
    expect(key.includes('|fail:')).toBe(false);
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
    createEscalation({ project, session: 'coordinator', kind: 'epic-ready-to-land', questionText: 'ready', todoId: null });
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

  test.each(['converged', 'abandoned'] as const)(
    'pinning a %s mission clears the pin and drives nothing (not even the other actionable mission)',
    async (terminalStatus) => {
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
      expect(getMission(project, target.missionId)?.status).toBe(terminalStatus);

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

    const escCalls: any[] = [];
    const createEscalationSpy = ((input: any) => {
      escCalls.push(input);
      return { escalation: { id: 'esc-1', ...input } as any, isNew: true };
    }) as typeof createEscalation;
    // Simulate the open card from a prior pass, matching kind + todoId + the criterion marker.
    const openCard: Escalation = {
      id: 'esc-open', project, session: 's1', kind: CRITERION_SERVE_CAP_KIND,
      questionText: `... ${serveCapMarker(crit.id)} ...`, status: 'open', createdAt: Date.now(),
      resolvedAt: null, serverId: '', todoId: forged.missionId, options: null, recommended: null,
      ui: null, routedTo: 'human', operatorGated: 1, proof: null, stewardAttempts: 0,
      suggestedAction: null, triageInFlight: false, resolvedBy: null,
      briefingMd: null, briefingModel: null, briefingAt: null,
    } as Escalation;

    const r = await runConductorPass(project, {
      invoke: okInvoke,
      createEscalation: createEscalationSpy,
      listOpenEscalations: () => [openCard],
    });

    expect(r.reason).toBe('criteria-escalated');
    expect(r.escalationsRaised).toBe(0); // debounced — the open card suppresses a duplicate
    expect(escCalls.length).toBe(0);
    expect(invokeCalls).toBe(0);
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
