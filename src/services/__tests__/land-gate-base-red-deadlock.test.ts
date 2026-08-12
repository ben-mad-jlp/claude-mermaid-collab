/**
 * Regression: a red BASE must not block the epic that repairs it.
 *
 * Incident 2026-08-07. `runRegressionFloor` runs the floor command ONLY in the epic
 * worktree and returns status:'fail' on any non-zero exit — an ABSOLUTE check, not a
 * differential one. A suite already red on the base therefore fails on the branch too,
 * and the failure path short-circuited with EMPTY regressions/inherited/incidents.
 * land-authority.ts then hit its catch-all:
 *
 *   if (gate.status === 'fail' && !regressions.length && !incidents.length)
 *     blockers.push({ code: 'gate-failed' })                      // land-authority.ts:481
 *
 * so the land was blocked with an opaque `gate-failed`, bypassing the
 * regressions-vs-inherited machinery that exists precisely to tell "this branch broke
 * something" from "this was already broken".
 *
 * The result was a DEADLOCK: while the base was red nothing could land, including the
 * epic whose whole purpose was to green the base. Epic a84acd18 — the three phantom-
 * 'vitest' typecheck fixes — failed to land three times (11:06, 11:08, 11:09), its
 * branch was then lost, and the mission sat stalled for hours with six leaves parked
 * epic-base-red on the very errors that epic would have fixed.
 *
 * The floor is now differential: failures already failing at this baseSha are INHERITED
 * (reported, never blocking); only net-new failures are regressions.
 */
import { describe, test, expect } from 'bun:test';
import {
  normalizeFloorTestName,
  partitionFloorAgainstBase,
} from '../epic-land-gate';

describe('floor failure names normalize across runs', () => {
  test('the run-position prefix is stripped so branch and base compare equal', () => {
    // The same suite reports a DIFFERENT position on each run — "(218/501)" on the branch,
    // "(53/501)" on the base — so a raw string compare never matches and every inherited
    // failure would read as net-new.
    expect(normalizeFloorTestName('(218/501) src/services/__tests__/x.test.ts'))
      .toBe('src/services/__tests__/x.test.ts');
    expect(normalizeFloorTestName('(53/501) src/services/__tests__/x.test.ts'))
      .toBe('src/services/__tests__/x.test.ts');
    expect(normalizeFloorTestName('(218/501) src/services/__tests__/x.test.ts'))
      .toBe(normalizeFloorTestName('(53/501) src/services/__tests__/x.test.ts'));
  });

  test('a name with no prefix, and a " > case" suffix, are left intact', () => {
    expect(normalizeFloorTestName('src/a.test.ts')).toBe('src/a.test.ts');
    expect(normalizeFloorTestName('  src/a.test.ts > does a thing  '))
      .toBe('src/a.test.ts > does a thing');
  });
});

describe('partitionFloorAgainstBase', () => {
  test('an unknown base yields NO inherited — every failure is treated as net-new', () => {
    // Fail-safe: without base evidence the gate must not hand out free passes.
    const r = partitionFloorAgainstBase('/no/such/project', null, ['(1/9) src/a.test.ts']);
    expect(r.inherited).toEqual([]);
    expect(r.regressed).toEqual(['(1/9) src/a.test.ts']);
  });

  test('an empty failing set partitions to empty', () => {
    const r = partitionFloorAgainstBase('/no/such/project', 'deadbeef', []);
    expect(r.regressed).toEqual([]);
    expect(r.inherited).toEqual([]);
  });
});

/**
 * The land-authority predicate this all feeds. Reproduced here as the pure boolean it is,
 * so the deadlock is pinned independently of the gate's I/O: the OLD shape (fail + empty
 * arrays) blocks, and the FIXED shape (failures classified inherited, none net-new) does
 * not — while a genuine regression still blocks.
 */
function blocksLand(gate: { status: string; regressions: unknown[]; incidents: unknown[] }): boolean {
  if (gate.regressions.length > 0) return true;                       // gate-regression
  if (gate.status === 'error' || gate.incidents.length > 0) return true; // gate-error
  return gate.status === 'fail' && gate.regressions.length === 0 && gate.incidents.length === 0;
}

describe('the land-authority predicate the floor feeds', () => {
  test('OLD shape — base-red floor reported as bare fail — BLOCKS (the deadlock)', () => {
    expect(blocksLand({ status: 'fail', regressions: [], incidents: [] })).toBe(true);
  });

  test('FIXED shape — base-red floor classified inherited, no net-new — does NOT block', () => {
    // Inherited failures live in gate.inherited, which the predicate deliberately ignores;
    // the status is no longer forced to 'fail' when nothing is net-new.
    expect(blocksLand({ status: 'pass', regressions: [], incidents: [] })).toBe(false);
  });

  test('a genuine regression STILL blocks — the fix must not become a bypass', () => {
    expect(blocksLand({ status: 'fail', regressions: [{ file: 'src/new.test.ts' }], incidents: [] })).toBe(true);
  });

  test('an incident still blocks', () => {
    expect(blocksLand({ status: 'fail', regressions: [], incidents: [{ file: 'src/x.test.ts' }] })).toBe(true);
  });
});
