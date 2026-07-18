import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stable supervisor dir (watched_project + node_profile_override caches); per-test project dir keeps
// the mission/decision/todo stores fresh.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass, conductorFingerprint, buildConductorPrompt } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled, createEscalation } from '../supervisor-store';
import { getMission, _resetMissionDbCache } from '../mission-store';
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
