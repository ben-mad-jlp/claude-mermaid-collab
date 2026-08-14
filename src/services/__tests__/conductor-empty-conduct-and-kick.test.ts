/**
 * EMPTY CONDUCT + operator KICK.
 *
 * The incident (mission 949dda42, 2026-08-14): a conductor pass ran `arm='node'` for 253 seconds
 * of Opus (15,921 output tokens), exited 0, journaled outcome 'conducted' — and filed NOTHING
 * (`filed: []`, `carried.count: 0`). Every pass from then on returned `debounced` with
 * `serveFp === passFp`, while three criteria sat at `discover`. The debounce compares a WORLD
 * fingerprint that only the conductor can move, so an empty conduct that anchors it locks the
 * mission forever.
 *
 * Two independent recoveries are covered here, and both are asserted against the LIVE wedge shape
 * (a journal that ALREADY holds a poisoned anchor row):
 *   1. the query-side fix — `latestProductivePassFp` refuses an empty conduct as an anchor, which
 *      heals an already-wedged mission with no migration and no row rewrite; bounded by
 *      CONDUCTOR_EMPTY_CONDUCT_CAP so it can never become unbounded self-excitation;
 *   2. the operator KICK — a one-shot force flag that gets a pass past the debounce and is
 *      consumed on the way through.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-empty-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import {
  runConductorPass,
  summariseCriteriaActions,
  CONDUCTOR_EMPTY_CONDUCTS_CAPPED_KIND,
  emptyConductConditionKey,
  conductorNeedsHuman,
  conductorStatusLine,
  CONDUCTOR_SERVE_RETRY_CAP,
} from '../conductor-pass';
import {
  listConductorPasses,
  appendPassProgress,
  openPassRow,
  finalizePassRow,
  isEmptyConductRow,
  latestProductivePassFp,
  countConsecutiveEmptyConducts,
  _closeConductorJournalDb,
  type ConductorPassJournalRow,
} from '../conductor-pass-journal';
import {
  requestConductorKick,
  consumeConductorKick,
  hasPendingConductorKick,
  _resetConductorKicks,
} from '../conductor-kick';
import { CONDUCTOR_EMPTY_CONDUCT_CAP } from '../harness-caps';
import { addWatchedProject, setConductorEnabled, listOpenEscalations } from '../supervisor-store';
import { _resetMissionDbCache, listCriteria, listCriteriaWithActions } from '../mission-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo, updateTodo } from '../todo-store';

let project: string;
let invokeCalls: number;

/** The EMPTY-CONDUCT node: exits ok, files nothing. On a mission whose only gap is a `verify`
 *  there are no `discover` ids to serve, so the productive-pass guard is satisfied VACUOUSLY and
 *  the pass journals 'conducted' — the 949dda42 shape exactly. */
const emptyConductInvoke = async () => {
  invokeCalls++;
  return { ok: true, rateLimited: false, text: 'REASONING SUMMARY: looked, found nothing to do' } as any;
};

const noPanel = async () => ({ paneled: [], held: [], skipped: [] }) as any;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-empty-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
  _closeConductorJournalDb();
  _resetConductorKicks();
});

/** Approved+active mission whose single criterion derives action 'verify' (one LANDED serving
 *  epic that did real work, no verdict yet). Its serve-state is STABLE across ticks: nothing the
 *  pass does changes the derived actions, which is what lets a run of empty conducts accumulate
 *  on ONE unchanged serveFp. */
async function forgeVerifyOnlyMission() {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Empty-conduct mission',
    criteria: ['the landed change still holds at HEAD'],
  });
  const crit = listCriteria(project, forged.missionId)[0];
  const epic = await createTodo(project, {
    ownerSession: 's1', title: '[EPIC] serve (landed)', kind: 'epic',
    parentId: forged.missionId, servesCriterionIds: [crit.id],
  });
  const leaf = await createTodo(project, {
    ownerSession: 's1', title: 'proof leaf', parentId: epic.id, servesCriterionIds: [crit.id],
  });
  await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
  await updateTodo(project, epic.id, { status: 'done' });
  return { forged, crit };
}

function rowsFor(missionId: string): ConductorPassJournalRow[] {
  return listConductorPasses(project, { missionId });
}

/** The newest pass row that RAN a node. */
function newestRanRow(missionId: string): ConductorPassJournalRow {
  const row = rowsFor(missionId).find((r) => r.ran === true);
  expect(row).toBeDefined();
  return row!;
}

/** Rewrite a journal row into the shape of a pass that FILED something — the healthy anchor.
 *  `passFp`/`selfFp` are left alone unless overridden, so the caller chooses whether this row
 *  should also debounce the next pass. */
function markRowProductive(row: ConductorPassJournalRow, fps?: { passFp: string | null; selfFp: string | null }): void {
  appendPassProgress(row.id, {
    filed: [{ kind: 'epic', id: 'epic-real-0001', title: 'served: a real gap' }],
    ...(fps ?? {}),
  });
}

describe('isEmptyConductRow — naming the shape that wore a success\'s clothes', () => {
  const base = {
    ran: true as boolean | null,
    outcome: 'conducted' as string | null,
    filed: [] as unknown,
    carried: null as ConductorPassJournalRow['carried'],
  };

  test('ran + conducted + nothing filed + nothing carried IS an empty conduct', () => {
    expect(isEmptyConductRow(base)).toBe(true);
    expect(isEmptyConductRow({ ...base, carried: { verify: [], serve: [], count: 0 } })).toBe(true);
  });

  test('anything actually filed, or carried, is NOT an empty conduct', () => {
    expect(isEmptyConductRow({ ...base, filed: [{ kind: 'epic', id: 'e1', title: 't' }] })).toBe(false);
    expect(isEmptyConductRow({ ...base, carried: { verify: ['c1'], serve: [], count: 1 } })).toBe(false);
  });

  test('a pass that never ran a node, or ended on another outcome, is NOT an empty conduct', () => {
    expect(isEmptyConductRow({ ...base, ran: false })).toBe(false);
    expect(isEmptyConductRow({ ...base, ran: null })).toBe(false);
    expect(isEmptyConductRow({ ...base, outcome: 'debounced' })).toBe(false);
    expect(isEmptyConductRow({ ...base, outcome: 'node-failed' })).toBe(false);
  });
});

describe('the journal refuses an empty conduct as the debounce anchor', () => {
  const MISSION = 'm-anchor';

  function seed(patch: Partial<ConductorPassJournalRow> & { startedAt: number }): string {
    const id = openPassRow(project, MISSION, patch.startedAt)!;
    finalizePassRow(id, {
      endedAt: patch.startedAt + 1,
      outcome: patch.outcome ?? 'conducted',
      ran: patch.ran ?? true,
      serveFp: patch.serveFp ?? 'S',
      passFp: patch.passFp ?? 'FP',
      selfFp: patch.selfFp ?? 'SELF',
      filed: patch.filed ?? [],
      carried: patch.carried ?? null,
    });
    return id;
  }

  test('a productive pass IS the anchor (unchanged behaviour)', () => {
    seed({ startedAt: 1000, filed: [{ kind: 'epic', id: 'e1', title: 'served' }] });
    expect(latestProductivePassFp(project, MISSION)).toEqual({ passFp: 'FP', selfFp: 'SELF' });
  });

  test('RETROACTIVE HEAL: an empty conduct in front of an older productive pass yields NO anchor', () => {
    // This is the journal a wedged mission holds TODAY: a real anchor, then the poisoned row.
    // Falling back to the older anchor would re-wedge whenever the two fingerprints agree, so the
    // walk STOPS: "the last thing the conductor did moved nothing" ⇒ there is no anchor.
    seed({ startedAt: 1000, filed: [{ kind: 'epic', id: 'e1', title: 'served' }] });
    seed({ startedAt: 2000, filed: [] });
    expect(latestProductivePassFp(project, MISSION)).toBeNull();
  });

  test('debounced/failed rows in between are transparent — they are not anchors either', () => {
    seed({ startedAt: 1000, filed: [{ kind: 'epic', id: 'e1', title: 'served' }] });
    seed({ startedAt: 2000, outcome: 'debounced', ran: false, passFp: 'OTHER' });
    seed({ startedAt: 3000, outcome: 'node-failed', passFp: 'OTHER' });
    expect(latestProductivePassFp(project, MISSION)).toEqual({ passFp: 'FP', selfFp: 'SELF' });
  });

  test('countConsecutiveEmptyConducts walks the contiguous run on ONE serveFp', () => {
    seed({ startedAt: 1000, filed: [] });
    seed({ startedAt: 2000, filed: [] });
    expect(countConsecutiveEmptyConducts(project, MISSION, 'S')).toBe(2);
    // A productive pass BREAKS the run…
    seed({ startedAt: 3000, filed: [{ kind: 'epic', id: 'e1', title: 'served' }] });
    expect(countConsecutiveEmptyConducts(project, MISSION, 'S')).toBe(0);
    // …and so does a different serve-state.
    seed({ startedAt: 4000, filed: [] });
    expect(countConsecutiveEmptyConducts(project, MISSION, 'S')).toBe(1);
    expect(countConsecutiveEmptyConducts(project, MISSION, 'DIFFERENT')).toBe(0);
    // A pass that never spent a node is transparent, not a break.
    seed({ startedAt: 5000, outcome: 'debounced', ran: false });
    expect(countConsecutiveEmptyConducts(project, MISSION, 'S')).toBe(1);
  });
});

describe('an empty conduct does not satisfy the debounce', () => {
  test('RETROACTIVE HEAL: a journal that ALREADY holds a poisoned anchor re-arms on the next pass', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();

    // Pass 1 leaves exactly the row a wedged mission is sitting on right now:
    // ran, outcome 'conducted', filed [] , carried 0 — and its passFp IS the current world fp.
    const p1 = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(p1.reason).toBe('conducted');
    expect(invokeCalls).toBe(1);
    const poisoned = newestRanRow(forged.missionId);
    expect(isEmptyConductRow(poisoned)).toBe(true);
    expect(poisoned.passFp).not.toBeNull();

    // No migration, no row rewrite, no human: the next pass RE-ARMS.
    // On master this returns { ran: false, reason: 'debounced' } and invokeCalls stays 1 forever.
    const p2 = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(p2.reason).not.toBe('debounced');
    expect(p2.ran).toBe(true);
    expect(invokeCalls).toBe(2);
  });

  test('a pass that FILED something still anchors the debounce (unchanged behaviour)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();

    await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(invokeCalls).toBe(1);
    // Same row, same fingerprints — the ONLY difference is that this pass filed something.
    markRowProductive(newestRanRow(forged.missionId));

    const p2 = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(p2.ran).toBe(false);
    expect(p2.reason).toBe('debounced');
    expect(invokeCalls).toBe(1); // no second node
  });

  test('the empty conduct records failCounted TRUTHFULLY (a real node ran and moved nothing)', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();
    await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(newestRanRow(forged.missionId).failCounted).toBe(true);
  });
});

describe('BOUNDED: the re-arm stops at CONDUCTOR_EMPTY_CONDUCT_CAP', () => {
  test('N consecutive empty conducts stop the re-arm and raise exactly ONE deduped card', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();

    for (let i = 0; i < CONDUCTOR_EMPTY_CONDUCT_CAP; i++) {
      const r = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
      expect(r.reason).toBe('conducted');
    }
    expect(invokeCalls).toBe(CONDUCTOR_EMPTY_CONDUCT_CAP);

    // At the cap: no more node spend, ever, on this serve-state.
    const capped = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(capped.ran).toBe(false);
    expect(capped.reason).toBe('conductor-empty-conducts-capped');
    expect(capped.emptyConducts).toBe(CONDUCTOR_EMPTY_CONDUCT_CAP);
    expect(invokeCalls).toBe(CONDUCTOR_EMPTY_CONDUCT_CAP);

    const cardsAfterFirst = listOpenEscalations().filter(
      (e) => e.project === project && e.kind === CONDUCTOR_EMPTY_CONDUCTS_CAPPED_KIND,
    );
    expect(cardsAfterFirst).toHaveLength(1);
    expect(cardsAfterFirst[0].todoId).toBe(forged.missionId);
    expect(cardsAfterFirst[0].questionText).toContain('Empty-conduct mission');
    expect(cardsAfterFirst[0].questionText).toContain('filed NOTHING');
    expect(cardsAfterFirst[0].questionText).toContain('1 criterion at verify');

    // Five more ticks: still capped, still ONE card (deduped by conditionKey), still no node.
    for (let i = 0; i < 5; i++) {
      const r = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
      expect(r.reason).toBe('conductor-empty-conducts-capped');
    }
    expect(invokeCalls).toBe(CONDUCTOR_EMPTY_CONDUCT_CAP);
    expect(
      listOpenEscalations().filter((e) => e.project === project && e.kind === CONDUCTOR_EMPTY_CONDUCTS_CAPPED_KIND),
    ).toHaveLength(1);
  });

  test('a PRODUCTIVE pass in between resets the counter', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();

    await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(invokeCalls).toBe(1);
    // Turn that first row into a productive one, but with fingerprints that do NOT match the
    // live world (so it breaks the empty run without also anchoring the debounce).
    markRowProductive(newestRanRow(forged.missionId), { passFp: 'unrelated-fp', selfFp: 'unrelated-self' });

    // With the reset, the following CAP passes still all run. Without it, pass number
    // CONDUCTOR_EMPTY_CONDUCT_CAP + 1 would already be capped.
    for (let i = 0; i < CONDUCTOR_EMPTY_CONDUCT_CAP; i++) {
      const r = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
      expect(r.reason).toBe('conducted');
    }
    expect(invokeCalls).toBe(CONDUCTOR_EMPTY_CONDUCT_CAP + 1);
    expect(
      listOpenEscalations().filter((e) => e.project === project && e.kind === CONDUCTOR_EMPTY_CONDUCTS_CAPPED_KIND),
    ).toHaveLength(0);
  });

  test('the capped reason is human-facing: needs-you, and a status line that says what happened', () => {
    expect(conductorNeedsHuman('conductor-empty-conducts-capped')).toBe(true);
    const line = conductorStatusLine('conductor-empty-conducts-capped', { emptyConducts: 2 });
    expect(line).toContain('filed nothing');
    expect(line).toContain('needs you');
    expect(line.length).toBeLessThanOrEqual(60);
  });

  test('summariseCriteriaActions names the shape the conductor saw', () => {
    expect(summariseCriteriaActions([])).toBe('no criteria');
    expect(summariseCriteriaActions([{ action: 'discover' }])).toBe('1 criterion at discover');
    expect(
      summariseCriteriaActions([
        { action: 'discover' }, { action: 'discover' }, { action: 'discover' }, { action: 'blocked' },
      ]),
    ).toBe('3 criteria at discover, 1 criterion at blocked');
  });

  test('the condition key is per (mission, serve-state)', () => {
    expect(emptyConductConditionKey('m1', 'S')).toBe('conductor-empty-conducts:m1:S');
    expect(emptyConductConditionKey('m1', 'S2')).not.toBe(emptyConductConditionKey('m1', 'S'));
  });
});

describe('the KICK flag is one-shot by construction', () => {
  test('a kick is consumed on the first read and never again', () => {
    requestConductorKick('/p', 'm1');
    expect(hasPendingConductorKick('/p', 'm1')).toBe(true);
    expect(consumeConductorKick('/p', 'm1')).toBe(true);
    expect(consumeConductorKick('/p', 'm1')).toBe(false);
    expect(hasPendingConductorKick('/p', 'm1')).toBe(false);
  });

  test('two kicks before a pass still buy exactly ONE pass — clicks cannot queue node spend', () => {
    requestConductorKick('/p', 'm1');
    requestConductorKick('/p', 'm1');
    expect(consumeConductorKick('/p', 'm1')).toBe(true);
    expect(consumeConductorKick('/p', 'm1')).toBe(false);
  });

  test('a project-wide kick (no missionId) is consumed by whichever mission the pass drives', () => {
    requestConductorKick('/p');
    expect(consumeConductorKick('/p', 'whatever-mission')).toBe(true);
    expect(consumeConductorKick('/p', 'whatever-mission')).toBe(false);
  });

  test('kicks do not leak across projects', () => {
    requestConductorKick('/p', 'm1');
    expect(consumeConductorKick('/other', 'm1')).toBe(false);
    expect(consumeConductorKick('/p', 'm1')).toBe(true);
  });
});

describe('the KICK forces exactly one pass past the debounce', () => {
  /** A mission wedged the way 949dda42 is: a valid anchor equal to the live fingerprint and a
   *  LONG run of debounced passes behind it. */
  async function wedgeWithDebounceStreak(streak: number) {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();
    await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    markRowProductive(newestRanRow(forged.missionId));
    for (let i = 0; i < streak; i++) {
      const r = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
      expect(r.reason).toBe('debounced');
    }
    expect(invokeCalls).toBe(1);
    return forged;
  }

  test('it clears a LONG-standing wedge (lastKey === fp with a 19-pass debounce streak)', async () => {
    const forged = await wedgeWithDebounceStreak(19);
    expect(rowsFor(forged.missionId).filter((r) => r.outcome === 'debounced')).toHaveLength(19);

    requestConductorKick(project, forged.missionId);
    const kicked = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(kicked.ran).toBe(true);
    expect(kicked.forced).toBe(true);
    expect(invokeCalls).toBe(2);
  });

  test('the flag is CONSUMED: the very next pass debounces again', async () => {
    const forged = await wedgeWithDebounceStreak(2);
    requestConductorKick(project, forged.missionId);
    await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(invokeCalls).toBe(2);
    // The kicked pass is itself an empty conduct, so it no longer anchors — restore the anchor
    // to isolate the ONE thing under test: the flag did not survive its own pass.
    markRowProductive(newestRanRow(forged.missionId));

    const after = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(after.ran).toBe(false);
    expect(after.reason).toBe('debounced');
    expect(invokeCalls).toBe(2); // sticky would have spent a third node here
  });

  test('the journal records the pass as OPERATOR-FORCED, so the panel can say why it ran', async () => {
    const forged = await wedgeWithDebounceStreak(1);
    requestConductorKick(project, forged.missionId);
    await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    const kickedRow = rowsFor(forged.missionId).find((r) => r.forced === true);
    expect(kickedRow).toBeDefined();
    expect(kickedRow!.ran).toBe(true);
    // Every OTHER pass is honestly un-forced.
    expect(rowsFor(forged.missionId).filter((r) => r.forced === true)).toHaveLength(1);
  });

  test('a kick does NOT bypass conductor-disabled', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();
    setConductorEnabled(project, false);
    requestConductorKick(project, forged.missionId);

    const r = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(r.reason).toBe('conductor-disabled');
    expect(invokeCalls).toBe(0);
  });

  test('a kick does NOT bypass daemon-off', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();
    setOrchestratorLevel(project, 'off');
    requestConductorKick(project, forged.missionId);

    const r = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(r.reason).toBe('daemon-off');
    expect(invokeCalls).toBe(0);
  });

  test('a kick does NOT bypass the empty-conduct cap', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();
    for (let i = 0; i < CONDUCTOR_EMPTY_CONDUCT_CAP; i++) {
      await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    }
    expect(invokeCalls).toBe(CONDUCTOR_EMPTY_CONDUCT_CAP);

    requestConductorKick(project, forged.missionId);
    const r = await runConductorPass(project, { invoke: emptyConductInvoke, verifyPanelArm: noPanel });
    expect(r.reason).toBe('conductor-empty-conducts-capped');
    expect(invokeCalls).toBe(CONDUCTOR_EMPTY_CONDUCT_CAP);
    // …and it was still SPENT, so it cannot sit around waiting to fire later.
    expect(hasPendingConductorKick(project, forged.missionId)).toBe(false);
  });

  test('a kick does NOT bypass the serve-retry cap', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const forged = await forgeMission(project, {
      session: 's1', title: 'Unservable mission', criteria: ['something the node keeps failing on'],
    });
    let failCalls = 0;
    const failInvoke = async () => { failCalls++; return { ok: false, rateLimited: false, text: '' } as any; };
    for (let i = 0; i < CONDUCTOR_SERVE_RETRY_CAP; i++) {
      const r = await runConductorPass(project, { invoke: failInvoke });
      expect(r.reason).toBe('node-failed');
    }
    expect(failCalls).toBe(CONDUCTOR_SERVE_RETRY_CAP);

    requestConductorKick(project, forged.missionId);
    const r = await runConductorPass(project, { invoke: failInvoke });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('debounced');
    expect(failCalls).toBe(CONDUCTOR_SERVE_RETRY_CAP); // no extra node
  });
});

describe('premise checks (so a green suite cannot be vacuous)', () => {
  test('the fixture mission really derives a single VERIFY criterion and no discover gap', async () => {
    addWatchedProject(project);
    setConductorEnabled(project, true);
    const { forged } = await forgeVerifyOnlyMission();
    const actions = listCriteriaWithActions(project, forged.missionId);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('verify');
  });
});
