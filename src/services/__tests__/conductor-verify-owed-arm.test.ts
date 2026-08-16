// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Conductor-side verify-owed backstop arm: scans listCriteriaWithActions (injected), selects
// criteria past threshold via the shared isVerifyOwedPastThreshold predicate, and raises one
// operatorGated human card keyed by the SAME verifyOwedConditionKey the mission-loop's future
// raise path uses. Harness mirrors escalation-conditionkey-purity.test.ts (temp
// MERMAID_SUPERVISOR_DIR set BEFORE the store import, _closeDb() in beforeEach).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolation: point the global supervisor.db at a temp dir BEFORE the store opens it.
const supDir = mkdtempSync(join(tmpdir(), 'vowed-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import { listEscalations, createEscalation, _closeDb } from '../supervisor-store';
import { verifyOwedConditionKey, type VerifyOwedCriterion } from '../mission-stall-predicate';
import { runVerifyOwedArm, VERIFY_OWED_BACKSTOP_KIND } from '../conductor-verify-owed-arm';

const projBase = mkdtempSync(join(tmpdir(), 'vowed-proj-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(projBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

beforeAll(() => { _closeDb(); });
beforeEach(() => {
  process.env.MERMAID_SUPERVISOR_DIR = supDir;
  _closeDb();
});
afterAll(() => {
  _closeDb();
  rmSync(supDir, { recursive: true, force: true });
  rmSync(projBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

function rowsFor(project: string) {
  return listEscalations().filter((e) => e.project === project);
}

const MISSION_ID = 'm1a2b3c4';
const SESSION = 'session-test';
const THRESHOLD_MS = 60_000;
const NOW = 1_000_000;

// A criterion whose landed timestamp is well past THRESHOLD_MS at NOW.
function owedCriterion(id: string): VerifyOwedCriterion {
  return {
    id,
    action: 'verify',
    servingEpicState: 'landed',
    servingEpicLandedAt: NOW - THRESHOLD_MS * 2,
  };
}

// A criterion that is not owed (under threshold).
function freshCriterion(id: string): VerifyOwedCriterion {
  return {
    id,
    action: 'verify',
    servingEpicState: 'landed',
    servingEpicLandedAt: NOW - THRESHOLD_MS / 2,
  };
}

describe('conductor-verify-owed-arm', () => {
  it('raises one operatorGated human card whose conditionKey equals verifyOwedConditionKey for the same mission and criterion ids', async () => {
    const project = freshProject();
    const owed = [owedCriterion('c1'), owedCriterion('c2')];

    const result = await runVerifyOwedArm(project, MISSION_ID, SESSION, {
      listCriteriaWithActions: (() => owed) as any,
      now: () => NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(result.owed.sort()).toEqual(['c1', 'c2']);
    expect(result.raised).toBe(true);
    expect(result.bumped).toBe(false);

    const expectedKey = verifyOwedConditionKey(MISSION_ID, ['c1', 'c2']);
    expect(result.conditionKey).toBe(expectedKey);

    const rows = rowsFor(project).filter((e) => e.conditionKey === expectedKey);
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind).toBe(VERIFY_OWED_BACKSTOP_KIND);
    expect(rows[0]!.operatorGated).toBeTruthy();
    expect(rows[0]!.audience).toBe('human');
    expect(rows[0]!.todoId).toBe(MISSION_ID);
    expect(rows[0]!.status).toBe('open');
  });

  it('returns the empty result and raises no card when no criterion is past threshold', async () => {
    const project = freshProject();
    const fresh = [freshCriterion('c1')];

    const result = await runVerifyOwedArm(project, MISSION_ID, SESSION, {
      listCriteriaWithActions: (() => fresh) as any,
      now: () => NOW,
      thresholdMs: THRESHOLD_MS,
    });

    expect(result).toEqual({ owed: [], raised: false, bumped: false, conditionKey: null });
    expect(rowsFor(project).length).toBe(0);
  });

  it('bumps recurrenceCount instead of raising a second card on an unresolved condition', async () => {
    const project = freshProject();
    const owed = [owedCriterion('c1')];
    const deps = {
      listCriteriaWithActions: (() => owed) as any,
      now: () => NOW,
      thresholdMs: THRESHOLD_MS,
    };

    const first = await runVerifyOwedArm(project, MISSION_ID, SESSION, deps);
    expect(first.raised).toBe(true);
    expect(first.bumped).toBe(false);

    const second = await runVerifyOwedArm(project, MISSION_ID, SESSION, deps);
    expect(second.raised).toBe(true);
    expect(second.bumped).toBe(true);
    expect(second.conditionKey).toBe(first.conditionKey);

    const rows = rowsFor(project).filter((e) => e.conditionKey === first.conditionKey);
    expect(rows.length).toBe(1);
    expect(rows[0]!.recurrenceCount).toBeGreaterThan(0);
  });

  it('leaves exactly one escalation row when both the conductor and the mission-loop observe the same condition', async () => {
    const project = freshProject();
    const owedIds = ['c1', 'c2'];
    const owed = owedIds.map(owedCriterion);

    // Conductor observes first, via the arm.
    const armResult = await runVerifyOwedArm(project, MISSION_ID, SESSION, {
      listCriteriaWithActions: (() => owed) as any,
      now: () => NOW,
      thresholdMs: THRESHOLD_MS,
    });
    expect(armResult.raised).toBe(true);

    // Mission-loop observes the SAME condition independently, deriving the key the same way
    // (simulated here by calling createEscalation directly with the shared key builder,
    // since mission-loop's own raise path is out of scope for this leaf).
    const sharedKey = verifyOwedConditionKey(MISSION_ID, owedIds);
    createEscalation({
      project,
      session: SESSION,
      kind: VERIFY_OWED_BACKSTOP_KIND,
      todoId: MISSION_ID,
      operatorGated: true,
      audience: 'human',
      conditionKey: sharedKey,
      conditionTuple: ['verify-owed', MISSION_ID, ...owedIds],
      questionText: 'mission-loop observation of the same verify-owed condition',
    });

    const rows = rowsFor(project).filter((e) => e.conditionKey === sharedKey);
    expect(rows.length).toBe(1);
  });

  it('is fail-open: a throwing listCriteriaWithActions yields the empty result and never rejects', async () => {
    const project = freshProject();

    const result = await runVerifyOwedArm(project, MISSION_ID, SESSION, {
      listCriteriaWithActions: (() => { throw new Error('store fault'); }) as any,
    });

    expect(result).toEqual({ owed: [], raised: false, bumped: false, conditionKey: null });
    expect(rowsFor(project).length).toBe(0);
  });

  it('is fail-open: a throwing createEscalation yields the empty result and never rejects', async () => {
    const project = freshProject();
    const owed = [owedCriterion('c1')];

    const result = await runVerifyOwedArm(project, MISSION_ID, SESSION, {
      listCriteriaWithActions: (() => owed) as any,
      now: () => NOW,
      thresholdMs: THRESHOLD_MS,
      createEscalation: (() => { throw new Error('escalation fault'); }) as any,
    });

    expect(result).toEqual({ owed: [], raised: false, bumped: false, conditionKey: null });
  });
});
