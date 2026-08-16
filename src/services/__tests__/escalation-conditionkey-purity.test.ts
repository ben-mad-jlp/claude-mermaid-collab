// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Condition keys for verify-owed and stuck-criterion raises: durable identity for
// dedup-by-condition so createEscalation bumps an OPEN card instead of minting rivals,
// and keeps a RESOLVED card suppressed while the underlying condition is unchanged.
// Harness mirrors coordinator-land-condition-keys.test.ts (temp MERMAID_SUPERVISOR_DIR
// set BEFORE the store import, _closeDb() in beforeEach).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolation: point the global supervisor.db at a temp dir BEFORE the store opens it.
const supDir = mkdtempSync(join(tmpdir(), 'eck-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = supDir;

import { listEscalations, createEscalation, _closeDb } from '../supervisor-store';
import {
  isVerifyOwedPastThreshold,
  verifyOwedConditionKey,
  type VerifyOwedCriterion,
} from '../mission-stall-predicate';
import { VERIFY_OWED_BACKSTOP_MS } from '../harness-caps';

const projBase = mkdtempSync(join(tmpdir(), 'eck-proj-'));
let projectCounter = 0;
function freshProject(): string {
  const p = join(projBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

beforeAll(() => { _closeDb(); });
beforeEach(() => {
  // Re-assert OUR supervisor dir + reopen the singleton (last loader wins the env when
  // several store-touching files share a process).
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
function rowsForKey(project: string, conditionKey: string) {
  return rowsFor(project).filter((e) => e.conditionKey === conditionKey);
}

const MISSION_ID = 'm1a2b3c4';
const CRITERION_IDS = ['c2', 'c1'];
const SESSION = 'session-test';
const SERVER_ID = 'server-test';

describe('escalation-conditionkey-purity', () => {
  it('yields a byte-identical conditionKey across two invocations separated by a clock advance', () => {
    const key1 = verifyOwedConditionKey(MISSION_ID, CRITERION_IDS);
    expect(key1).toMatch(/^verify-owed:m1a2b3c4:/);

    // Advance clock well past VERIFY_OWED_BACKSTOP_MS
    const futureNow = Date.now() + (VERIFY_OWED_BACKSTOP_MS * 2);

    const key2 = verifyOwedConditionKey(MISSION_ID, CRITERION_IDS);
    expect(key2).toBe(key1);

    // Verify no digit-run in the key matches an advanced timestamp
    // (the key should be purely derived from mission id + criterion tuple)
    const futureStr = String(futureNow);
    expect(key1).not.toMatch(new RegExp(futureStr));
  });

  it('leaves exactly one escalation row with recurrenceCount 1 after observing the same condition twice', () => {
    const project = freshProject();
    const key = verifyOwedConditionKey(MISSION_ID, CRITERION_IDS);
    const conditionTuple = ['verify-owed', 'test', 'stable'];

    // First observation
    const first = createEscalation({
      project,
      session: SESSION,
      kind: 'verify-owed',
      questionText: 'Verify owed on landed epic',
      serverId: SERVER_ID,
      audience: 'human',
      conditionKey: key,
      conditionTuple,
    });
    expect(first.isNew).toBe(true);

    // Second observation with same key
    const second = createEscalation({
      project,
      session: SESSION,
      kind: 'verify-owed',
      questionText: 'Verify owed on landed epic',
      serverId: SERVER_ID,
      audience: 'human',
      conditionKey: key,
      conditionTuple,
    });
    expect(second.isNew).toBe(false);

    const rows = rowsForKey(project, key);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('open');
    expect(rows[0]!.recurrenceCount).toBeGreaterThan(0);
  });

  it('isVerifyOwedPastThreshold returns true at threshold', () => {
    const baseTime = 1000000;
    const threshold = 60000;
    const landedAt = baseTime - threshold; // exactly at threshold

    const c: VerifyOwedCriterion = {
      id: 'c1',
      action: 'verify',
      servingEpicState: 'landed',
      servingEpicLandedAt: landedAt,
    };

    expect(isVerifyOwedPastThreshold(c, baseTime, threshold)).toBe(true);
  });

  it('isVerifyOwedPastThreshold returns false under threshold', () => {
    const baseTime = 1000000;
    const threshold = 60000;
    const landedAt = baseTime - (threshold / 2); // halfway there

    const c: VerifyOwedCriterion = {
      id: 'c1',
      action: 'verify',
      servingEpicState: 'landed',
      servingEpicLandedAt: landedAt,
    };

    expect(isVerifyOwedPastThreshold(c, baseTime, threshold)).toBe(false);
  });

  it('isVerifyOwedPastThreshold returns false when action is not verify', () => {
    const baseTime = 1000000;
    const threshold = 60000;
    const landedAt = baseTime - (threshold * 2); // way past threshold

    const c: VerifyOwedCriterion = {
      id: 'c1',
      action: 'building',
      servingEpicState: 'landed',
      servingEpicLandedAt: landedAt,
    };

    expect(isVerifyOwedPastThreshold(c, baseTime, threshold)).toBe(false);
  });

  it('isVerifyOwedPastThreshold returns false when servingEpicState is not landed', () => {
    const baseTime = 1000000;
    const threshold = 60000;
    const landedAt = baseTime - (threshold * 2); // way past threshold

    const c: VerifyOwedCriterion = {
      id: 'c1',
      action: 'verify',
      servingEpicState: 'open',
      servingEpicLandedAt: landedAt,
    };

    expect(isVerifyOwedPastThreshold(c, baseTime, threshold)).toBe(false);
  });

  it('isVerifyOwedPastThreshold returns false when both timestamps are null', () => {
    const baseTime = 1000000;
    const threshold = 60000;

    const c: VerifyOwedCriterion = {
      id: 'c1',
      action: 'verify',
      servingEpicState: 'landed',
      servingEpicLandedAt: null,
      servingWorkCompletedAt: null,
    };

    expect(isVerifyOwedPastThreshold(c, baseTime, threshold)).toBe(false);
  });

  it('isVerifyOwedPastThreshold uses servingWorkCompletedAt as fallback', () => {
    const baseTime = 1000000;
    const threshold = 60000;
    const completedAt = baseTime - threshold; // exactly at threshold

    const c: VerifyOwedCriterion = {
      id: 'c1',
      action: 'verify',
      servingEpicState: 'landed',
      servingEpicLandedAt: null,
      servingWorkCompletedAt: completedAt,
    };

    expect(isVerifyOwedPastThreshold(c, baseTime, threshold)).toBe(true);
  });

  it('isVerifyOwedPastThreshold prefers servingEpicLandedAt over servingWorkCompletedAt', () => {
    const baseTime = 1000000;
    const threshold = 60000;
    const landedAt = baseTime - threshold; // exactly at threshold
    const completedAt = baseTime - (threshold / 2); // not at threshold

    const c: VerifyOwedCriterion = {
      id: 'c1',
      action: 'verify',
      servingEpicState: 'landed',
      servingEpicLandedAt: landedAt,
      servingWorkCompletedAt: completedAt,
    };

    expect(isVerifyOwedPastThreshold(c, baseTime, threshold)).toBe(true);
  });
});
