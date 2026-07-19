import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stable supervisor dir (watched_project + node_profile_override caches); per-test project dir keeps
// the mission/decision/todo stores fresh.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass, conductorFingerprint, buildConductorPrompt } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled, createEscalation, getConductorTargetMission, setConductorTargetMission, getConductorLastPass } from '../supervisor-store';
import { getMission, _resetMissionDbCache, setMissionAbandoned, setCriterionMet } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { planMissionCriterion } from '../../mcp/tools/mission-planner';
import { listCriteria } from '../mission-store';

let project: string;
let invokeCalls: number;
const okInvoke = async () => { invokeCalls++; return { ok: true, rateLimited: false, text: 'served the gap' } as any; };

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
});

async function forgeApprovedActive() {
  return forgeMission(project, { session: 's1', title: 'The reviewer never over-rejects', criteria: ['a correct leaf is accepted'] });
}

describe('runConductorPass — scheduling', () => {
  test('disabled toggle ⇒ no-op, no node spawned', async () => {
    await forgeApprovedActive();
    const r = await runConductorPass(project, { invoke: okInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('conductor-disabled');
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
