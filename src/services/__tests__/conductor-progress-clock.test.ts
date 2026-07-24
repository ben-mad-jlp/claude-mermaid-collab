/**
 * conductor-progress-clock — incident-replay regression suite for three conductor debounce
 * incidents (self-excitation, sleep-forever, rival starvation), each driven end-to-end through
 * `runConductorPass` with injected deps only. No git, no gate spawn, no real node.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stable supervisor dir (watched_project + escalation stores); per-test project dir keeps the
// mission/todo stores fresh.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-progress-clock-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass, type ConductorPassDeps } from '../conductor-pass';
import { runInfraRejectionArm, type EpicBaseProbe } from '../conductor-infra-arm';
import { UNKNOWN_LANE_SIGNATURE } from '../conductor-wake-gate';
import { addWatchedProject, setConductorEnabled, createEscalation, resolveEscalation } from '../supervisor-store';
import {
  _resetMissionDbCache,
  listCriteria,
  listCriteriaWithActions,
  getMission,
  stampConductorRun,
} from '../mission-store';
import { CONDUCTOR_SERVE_RETRY_CAP } from '../conductor-pass';
import { CONDUCTOR_LEADER_STALE_TICKS, CONDUCTOR_BEAT_MS } from '../harness-caps';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo, updateTodo } from '../todo-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { recordNode } from '../worker-ledger';

let project: string;
let invokeCalls: number;

const BASE_RED_REASON = 'epic-base-red: npx tsc --noEmit\n--- output (tail) ---\nerror TS2345';
const failProbe: EpicBaseProbe = async () => 'fail';

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-progress-clock-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
  addWatchedProject(project);
  setConductorEnabled(project, true);
  setOrchestratorLevel(project, 'on');
});

/** SINGLE call site for runConductorPass in this file (criterion 6): every replay drives the
 *  pass through this helper. Defaults to a counting invoke + a statically-red base probe so a
 *  replay that overrides nothing still stays hermetic. */
const tick = (over: ConductorPassDeps = {}) =>
  runConductorPass(project, { invoke: countingInvoke, epicBaseProbe: failProbe, ...over });

const countingInvoke = async () => {
  invokeCalls++;
  return { ok: true, rateLimited: false, text: 'noop' } as any;
};

/** The LLM-no-op mock: returns ok but files no epic, so the productive-pass guard treats it as
 *  a failed attempt (node-failed), not a success. */
const emptyServeInvoke = async () => {
  invokeCalls++;
  return { ok: true, rateLimited: false, text: 'looked but did nothing' } as any;
};

/** Serves whichever mission the pass is actually driving (read from `ledgerTodoId` on the spec,
 *  not from active-mission ambiguity — replay 3 runs TWO active missions at once). */
const servingInvoke = async (spec: { ledgerTodoId?: string }) => {
  invokeCalls++;
  const missionId = spec.ledgerTodoId;
  if (missionId) {
    for (const c of listCriteriaWithActions(project, missionId).filter((x) => x.action === 'discover')) {
      await createTodo(project, {
        ownerSession: 's1',
        title: `[EPIC] served ${c.id}`,
        kind: 'epic',
        parentId: missionId,
        servesCriterionIds: [c.id],
      });
    }
  }
  return { ok: true, rateLimited: false, text: 'served the gap' } as any;
};

/** Forge an approved+active mission with ONE serving epic carrying ONE rejected leaf whose
 *  durable terminal ledger reason is `reason` (mirrors conductor-infra-arm.test.ts's
 *  seedRejectedLeaf fixture). */
async function seedRejectedLeaf(reason: string) {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Base repair drives stuck leaves',
    criteria: ['a leaf parked on a red base re-dispatches once the base is green'],
  });
  const crit = listCriteria(project, forged.missionId)[0];
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
    title: 'the stuck leaf',
    parentId: epic.id,
    status: 'ready',
  });
  await updateTodo(project, leaf.id, { acceptanceStatus: 'rejected' });
  recordNode({
    project,
    todoId: leaf.id,
    epicId: epic.id,
    leafId: leaf.id,
    session: 's1',
    nodeKind: 'outcome',
    nodesSpent: 0,
    leafOutcome: 'rejected',
    outcomeDetail: JSON.stringify({ reason }),
  });
  return { forged, crit, epic, leaf };
}

describe('conductor progress clock — incident replays', () => {
  test('self-excitation (2026-07-23 20:45-21:20): a statically-red base buys exactly ONE node, then debounces forever', async () => {
    await seedRejectedLeaf(BASE_RED_REASON);
    // Keep the pass git-free: inject the wake-gate lane signature so the fail-open default
    // (unknown ⇒ never skip) never needs a real git spawn.
    const gitFreeArm: ConductorPassDeps['infraArm'] = (p, m, s, d) =>
      runInfraRejectionArm(p, m, s, { ...d, laneSignature: async () => UNKNOWN_LANE_SIGNATURE });

    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(await tick({ infraArm: gitFreeArm }));
    }

    expect(invokeCalls).toBe(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].reason).toBe('debounced');
    }
  });

  test('sleep-forever (2026-07-24, 636eee87): an open hard card caps retries; resolving it re-arms the VERY next tick', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Undelegatable criterion never re-serves on its own',
      criteria: ['a live measurement cannot be automated'],
    });
    const { escalation } = createEscalation({
      project,
      session: 's1',
      kind: 'blocker',
      todoId: forged.missionId,
      questionText: 'blocked on a human decision',
    });

    for (let i = 0; i < CONDUCTOR_SERVE_RETRY_CAP; i++) {
      const r = await tick({ invoke: emptyServeInvoke });
      expect(r.reason).toBe('node-failed');
    }
    const cappedInvokeCalls = invokeCalls;
    const capped = await tick({ invoke: emptyServeInvoke });
    expect(capped.reason).toBe('debounced');
    expect(invokeCalls).toBe(cappedInvokeCalls); // frozen — the cap spends nothing further

    resolveEscalation(escalation.id, 'resolved');

    const rearmed = await tick({ invoke: emptyServeInvoke });
    expect(rearmed.ran).toBe(true);
    expect(invokeCalls).toBe(cappedInvokeCalls + 1);
  });

  test('rival starvation (07b5d3c0): a stale, still-gapped leader yields to its rival within the stale-tick bound', async () => {
    const leader = await forgeMission(project, {
      session: 's1',
      title: 'Leader mission holds a discover gap forever',
      criteria: ['leader gap never served'],
    });
    const rival = await forgeMission(project, {
      session: 's2',
      title: 'Rival mission is starved by the leader',
      criteria: ['rival gap gets served eventually'],
    });

    // Cap whichever mission the deterministic total order heads with first (tie-break may pick
    // either forged mission — the replay only cares that ONE of them starves the other).
    const leaderId = (await tick({ invoke: emptyServeInvoke })).missionId!;
    expect([leader.missionId, rival.missionId]).toContain(leaderId);
    const starvedId = leaderId === leader.missionId ? rival.missionId : leader.missionId;
    for (let i = 1; i < CONDUCTOR_SERVE_RETRY_CAP; i++) {
      const r = await tick({ invoke: emptyServeInvoke });
      expect(r.missionId).toBe(leaderId);
    }

    const leaderRow = getMission(project, leaderId)!;
    stampConductorRun(project, leaderId, leaderRow.lastConductorKey!, {
      at: Date.now() - (CONDUCTOR_LEADER_STALE_TICKS * CONDUCTOR_BEAT_MS + 1),
    });

    const missionIds: (string | undefined)[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await tick({ invoke: servingInvoke });
      missionIds.push(r.missionId);
    }

    const firstStale = missionIds.slice(0, CONDUCTOR_LEADER_STALE_TICKS);
    expect(firstStale).toContain(starvedId);
    expect(missionIds.filter((id) => id === starvedId).length).toBeGreaterThan(0);
  });
});
