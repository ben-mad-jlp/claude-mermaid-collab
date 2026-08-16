// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// FIX 3, "Provable Criteria": MISSION criteria are now validated at the WRITE choke point
// with the same proven predicate leaf blueprints have used since L4 (classifyCriterion in
// criteria-citability.ts). Previously mission-store called it nowhere, so a criterion that
// can never be cited ("the suite passes", "no new files") could hold a mission open for days.
//
// Three properties under test:
//   1. write-time refusal, with a PRESCRIPTIVE message naming the compliant shape;
//   2. a DROP cannot manufacture a clean convergence — but must still leave the mission
//      TERMINAL (the anti-wedge half is asserted in the same test as the honesty half);
//   3. an unreasoned drop is refused, and grandfathered rows still read.
//
// The gate is enforced UNCONDITIONALLY — no NODE_ENV/env hatch. Only three existing fixture
// criteria in the whole suite were refused by it (fixed in place), so it never needed the
// MERMAID_ENFORCE_PARENTLESS_LEAF-style escape the ~250 bare-leaf fixtures forced on that guard.
//
// Hermetic: every test runs against a fresh mkdtemp project; no real .collab/*.db and no
// ~/.mermaid-collab access.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, _closeProject, openDb } from '../todo-store';
import {
  upsertMission, addCriterion, listCriteria, updateCriterionText, setCriterionMet,
  dropCriterion, getMissionRollup, isMissionTerminal, getMission, _resetMissionDbCache,
  assertMissionCriterionCitable, missionTerminalReason,
  UncitableMissionCriterionError, UnreasonedCriterionDropError,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

async function makeMission(title = '[MISSION] citability gate') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  upsertMission(project, t.id);
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-crit-gate-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission criterion citability gate (write-time)', () => {
  test('a criterion asserting a command RESULT is refused, and the message names a compliant shape', async () => {
    const id = await makeMission();
    let err: unknown;
    try {
      addCriterion(project, id, 'the full test suite passes and the build is green');
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(UncitableMissionCriterionError);
    const message = (err as Error).message;
    expect(message).toContain('uncitable-mission-criterion');
    expect((err as UncitableMissionCriterionError).kind).toBe('command-result');
    // PRESCRIPTIVE, not merely prohibitive: the refusal must name the shape that WOULD pass.
    expect(message).toContain('Compliant shape:');
    expect(message).toContain('name what the command PRODUCES, not that it succeeds');
    // ...and it must not have been written.
    expect(listCriteria(project, id)).toHaveLength(0);
  });

  test('a criterion asserting a bare ABSENCE is refused, with the absence-shaped rewrite', async () => {
    const id = await makeMission();
    let err: unknown;
    try {
      addCriterion(project, id, 'No new files are added under src/services');
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(UncitableMissionCriterionError);
    expect((err as UncitableMissionCriterionError).kind).toBe('absence');
    const message = (err as Error).message;
    expect(message).toContain('asserts an absence');
    expect(message).toContain('Compliant shape:');
    expect(message).toContain('outOfScope');
    expect(listCriteria(project, id)).toHaveLength(0);
  });

  test('a CITABLE criterion is accepted unchanged', async () => {
    const id = await makeMission();
    const text = 'mission-store.ts refuses an uncitable mission criterion at the write choke point';
    const c = addCriterion(project, id, text);

    expect(c.text).toBe(text);
    const rows = listCriteria(project, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe(text);
    expect(rows[0]!.status).toBe('active');
  });

  test('updateCriterionText is gated too — the refusal cannot be walked around by editing', async () => {
    const id = await makeMission();
    const c = addCriterion(project, id, 'the rollup reports a distinct terminalReason for a with-drops convergence');

    expect(() => updateCriterionText(project, c.id, 'bun test passes')).toThrow(UncitableMissionCriterionError);
    // Original text survives the refused edit.
    expect(listCriteria(project, id)[0]!.text).toContain('terminalReason');
  });

  test('assertMissionCriterionCitable is a pure predicate over the text alone', () => {
    expect(() => assertMissionCriterionCitable('npx tsc --noEmit exits 0')).toThrow(UncitableMissionCriterionError);
    expect(() => assertMissionCriterionCitable('the conductor pass records a verdict row per criterion')).not.toThrow();
  });
});

describe('a DROP must not manufacture convergence — and must not wedge the mission', () => {
  test('all ACTIVE criteria met + >=1 DROPPED reads as convergedWithDrops, NOT converged, and is still terminal/stopped', async () => {
    const id = await makeMission('[MISSION] drop-honesty');
    for (let i = 0; i < 3; i++) {
      const c = addCriterion(project, id, `criterion ${i}: the store exposes a distinct rollup field ${i}`);
      setCriterionMet(project, c.id, true);
    }
    const cut = addCriterion(project, id, 'criterion X: the conductor drives a second project concurrently');
    await dropCriterion(project, cut.id, { reason: 'out of scope for this mission', by: 'tester' });

    const rollup = getMissionRollup(project, id);

    // HONESTY: dropping is arithmetically indistinguishable from satisfying under the old
    // rollup (total counts only ACTIVE criteria), so a clean `converged` must be reserved
    // for a mission that carried zero drops.
    expect(rollup.capability).toEqual({ met: 3, total: 3, dropped: 1 });
    expect(rollup.converged).toBe(false);
    expect(rollup.convergedWithDrops).toBe(true);
    expect(rollup.terminalReason).toBe('converged-with-drops');

    // ANTI-WEDGE: it is STILL a stop. The daemon must never spin on this mission forever.
    expect(rollup.stopped).toBe(true);
    expect(isMissionTerminal(getMission(project, id)!)).toBe(true);
  });

  test('zero drops still reads as a clean convergence', async () => {
    const id = await makeMission('[MISSION] clean');
    const c = addCriterion(project, id, 'the rollup carries a convergedWithDrops flag');
    setCriterionMet(project, c.id, true);

    const rollup = getMissionRollup(project, id);
    expect(rollup.converged).toBe(true);
    expect(rollup.convergedWithDrops).toBe(false);
    expect(rollup.terminalReason).toBe('converged');
    expect(rollup.stopped).toBe(true);
  });

  test('missionTerminalReason labels a terminal mission and never invents terminality', () => {
    expect(missionTerminalReason({ status: 'building', abandonedAt: null, closedAt: null }, 3)).toBeNull();
    expect(missionTerminalReason({ status: 'converged', abandonedAt: null, closedAt: null }, 0)).toBe('converged');
    expect(missionTerminalReason({ status: 'converged', abandonedAt: null, closedAt: null }, 1)).toBe('converged-with-drops');
    expect(missionTerminalReason({ status: 'closed', abandonedAt: null, closedAt: 5 }, 2)).toBe('converged-with-drops');
    expect(missionTerminalReason({ status: 'abandoned', abandonedAt: 7, closedAt: null }, 4)).toBe('abandoned');
  });
});

describe('a DROP must carry a reason', () => {
  test('a drop with no reason is refused and leaves the criterion active', async () => {
    const id = await makeMission('[MISSION] drop reason');
    const c = addCriterion(project, id, 'the drop path stamps droppedReason on the row');

    await expect(dropCriterion(project, c.id, { reason: '', by: 'tester' })).rejects.toThrow(UnreasonedCriterionDropError);
    await expect(dropCriterion(project, c.id, { reason: '   ', by: 'tester' })).rejects.toThrow(/unreasoned-criterion-drop/);

    expect(listCriteria(project, id)[0]!.status).toBe('active');
    expect(getMissionRollup(project, id).capability.dropped).toBe(0);
  });

  test('a drop WITH a reason succeeds and the reason is visible on the row + counted in the rollup', async () => {
    const id = await makeMission('[MISSION] drop reason ok');
    const keep = addCriterion(project, id, 'the rollup counts a dropped criterion separately');
    setCriterionMet(project, keep.id, true);
    const c = addCriterion(project, id, 'the store exposes an undrop path for a re-armed criterion');
    await dropCriterion(project, c.id, { reason: 'superseded by criterion 1', by: 'tester' });

    const row = listCriteria(project, id).find((r) => r.id === c.id)!;
    expect(row.status).toBe('dropped');
    expect(row.droppedReason).toBe('superseded by criterion 1');
    expect(row.droppedBy).toBe('tester');
    expect(row.droppedAt).toBeGreaterThan(0);

    const rollup = getMissionRollup(project, id);
    expect(rollup.capability.dropped).toBe(1);
    expect(rollup.convergedWithDrops).toBe(true);
  });
});

describe('grandfathering: the gate is WRITE-TIME only', () => {
  test('a pre-existing uncitable criterion row still reads, and non-text updates still work', async () => {
    const id = await makeMission('[MISSION] legacy rows');
    // Simulate a row written before the gate existed by inserting past the store's writer.
    const db = openDb(project);
    const legacyText = 'the whole build passes and no new files are added';
    db.prepare(
      'INSERT INTO mission_criterion (id, todoId, text, met, "order", updatedAt, type, dependsOn, nickname) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)',
    ).run('crit_legacy_1', id, legacyText, Date.now(), 'capability', '[]', 'legacy');

    const rows = listCriteria(project, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe(legacyText);

    // A non-text mutation (met verdict) on the grandfathered row is unaffected by the gate.
    setCriterionMet(project, 'crit_legacy_1', true);
    expect(listCriteria(project, id)[0]!.met).toBe(true);
    expect(getMissionRollup(project, id).converged).toBe(true);

    // Dropping it (with a reason) is also fine — the gate never retro-validates.
    await dropCriterion(project, 'crit_legacy_1', { reason: 'legacy prose, unmeetable', by: 'tester' });
    expect(listCriteria(project, id)[0]!.status).toBe('dropped');
  });

  test('the gate has NO env hatch — it is enforced under the test runner too', async () => {
    const id = await makeMission('[MISSION] no hatch');
    expect(process.env.NODE_ENV).toBe('test');
    // No env var switches this off: a prohibition a test flag can disable is not a constraint.
    expect(() => addCriterion(project, id, 'the build passes')).toThrow(UncitableMissionCriterionError);
  });
});
