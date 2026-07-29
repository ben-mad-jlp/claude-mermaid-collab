import { describe, test, expect, beforeEach } from 'bun:test';
import {
  evaluateMissionStall,
  missionStallConditionKey,
  noteStallObservation,
  clearStallObservation,
  IN_FLIGHT_COUNTER_KEYS,
  _resetStallObservations,
  type MissionStallFacts,
} from '../mission-stall-predicate';

const PROJECT = '/p';
const MISSION_ID = 'm1';

beforeEach(() => {
  _resetStallObservations();
});

// ---------------------------------------------------------------------------
// Test (a): Stall conjunction — baseFacts baseline + stall-defeating cases
// ---------------------------------------------------------------------------

describe('stall conjunction', () => {
  /**
   * baseFacts: the minimal facts that SHOULD evaluate to stalled: true.
   * All in-flight counters are 0, budget not paused, base not red-cooldown,
   * at least one blocked criterion, no open card, mission active, unmet criteria > 0.
   */
  function baseFacts(): MissionStallFacts {
    return {
      missionActive: true,
      unmetCriteria: 1,
      serveableGaps: 0,
      awaitingVerify: 0,
      verifyInFlight: 0,
      epicsBuilding: 0,
      leavesRunning: 0,
      landInFlight: 0,
      integrating: 0,
      recycling: 0,
      budgetPaused: false,
      baseRedCooldown: false,
      blockedCriterionIds: ['c1'],
      hasOpenCardForKey: false,
    };
  }

  test('baseFacts evaluates to stalled: true', () => {
    const facts = baseFacts();
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(true);
    expect(result.conditionKey).not.toBeNull();
    expect(result.blockedCriterionIds).toEqual(['c1']);
  });

  test('missionActive: false breaks the stall', () => {
    const facts = baseFacts();
    facts.missionActive = false;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('unmetCriteria: 0 breaks the stall', () => {
    const facts = baseFacts();
    facts.unmetCriteria = 0;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('budgetPaused: true breaks the stall', () => {
    const facts = baseFacts();
    facts.budgetPaused = true;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('baseRedCooldown: true breaks the stall', () => {
    const facts = baseFacts();
    facts.baseRedCooldown = true;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('blockedCriterionIds: [] breaks the stall', () => {
    const facts = baseFacts();
    facts.blockedCriterionIds = [];
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('hasOpenCardForKey: true breaks the stall', () => {
    const facts = baseFacts();
    facts.hasOpenCardForKey = true;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  // Test each in-flight counter independently
  test('serveableGaps: 1 breaks the stall', () => {
    const facts = baseFacts();
    facts.serveableGaps = 1;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('awaitingVerify: 1 breaks the stall', () => {
    const facts = baseFacts();
    facts.awaitingVerify = 1;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('verifyInFlight: 1 breaks the stall', () => {
    const facts = baseFacts();
    facts.verifyInFlight = 1;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('epicsBuilding: 1 breaks the stall', () => {
    const facts = baseFacts();
    facts.epicsBuilding = 1;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('leavesRunning: 1 breaks the stall', () => {
    const facts = baseFacts();
    facts.leavesRunning = 1;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('landInFlight: 1 breaks the stall', () => {
    const facts = baseFacts();
    facts.landInFlight = 1;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('integrating: 1 breaks the stall', () => {
    const facts = baseFacts();
    facts.integrating = 1;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('recycling: 1 breaks the stall', () => {
    const facts = baseFacts();
    facts.recycling = 1;
    const result = evaluateMissionStall(facts, MISSION_ID);
    expect(result.stalled).toBe(false);
  });

  test('IN_FLIGHT_COUNTER_KEYS includes all the right counters', () => {
    expect(IN_FLIGHT_COUNTER_KEYS).toEqual([
      'serveableGaps',
      'awaitingVerify',
      'verifyInFlight',
      'epicsBuilding',
      'leavesRunning',
      'landInFlight',
      'integrating',
      'recycling',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Test (b): Condition key — order-independence and content-sensitivity
// ---------------------------------------------------------------------------

describe('missionStallConditionKey', () => {
  test('order independence: same ids in different order produce the same key', () => {
    const key1 = missionStallConditionKey('m1', ['c2', 'c1']);
    const key2 = missionStallConditionKey('m1', ['c1', 'c2']);
    expect(key1).toBe(key2);
  });

  test('content sensitivity: differing id sets produce different keys', () => {
    const key1 = missionStallConditionKey('m1', ['c1', 'c2']);
    const key2 = missionStallConditionKey('m1', ['c1', 'c3']);
    expect(key1).not.toBe(key2);
  });

  test('key format includes mission id and hash', () => {
    const key = missionStallConditionKey('m1', ['c1']);
    expect(key).toContain('mission-stalled:m1:');
    expect(key.split(':').length).toBe(3);
  });

  test('different missions produce different keys for the same criteria', () => {
    const key1 = missionStallConditionKey('m1', ['c1']);
    const key2 = missionStallConditionKey('m2', ['c1']);
    expect(key1).not.toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// Test (c): StableForTicks tracker
// ---------------------------------------------------------------------------

describe('stableForTicks observation tracker', () => {
  test('first observation of a condition returns 1', () => {
    const count = noteStallObservation(PROJECT, MISSION_ID, 'k1');
    expect(count).toBe(1);
  });

  test('second observation of the same condition returns 2', () => {
    noteStallObservation(PROJECT, MISSION_ID, 'k1');
    const count = noteStallObservation(PROJECT, MISSION_ID, 'k1');
    expect(count).toBe(2);
  });

  test('observation of a different condition resets to 1', () => {
    noteStallObservation(PROJECT, MISSION_ID, 'k1');
    noteStallObservation(PROJECT, MISSION_ID, 'k1');
    const count = noteStallObservation(PROJECT, MISSION_ID, 'k2');
    expect(count).toBe(1);
  });

  test('clearStallObservation removes the entry', () => {
    noteStallObservation(PROJECT, MISSION_ID, 'k1');
    clearStallObservation(PROJECT, MISSION_ID);
    const count = noteStallObservation(PROJECT, MISSION_ID, 'k1');
    expect(count).toBe(1);
  });

  test('independent missions maintain separate counts', () => {
    const count1 = noteStallObservation(PROJECT, 'm1', 'k1');
    const count2 = noteStallObservation(PROJECT, 'm2', 'k1');
    expect(count1).toBe(1);
    expect(count2).toBe(1);
    const count3 = noteStallObservation(PROJECT, 'm1', 'k1');
    expect(count3).toBe(2);
  });

  test('independent projects maintain separate counts', () => {
    const count1 = noteStallObservation('/p1', MISSION_ID, 'k1');
    const count2 = noteStallObservation('/p2', MISSION_ID, 'k1');
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  test('clearStallObservation is idempotent (no error on missing entry)', () => {
    clearStallObservation(PROJECT, 'nonexistent');
    // Should not throw; just verify a note afterwards still starts at 1
    const count = noteStallObservation(PROJECT, 'nonexistent', 'k1');
    expect(count).toBe(1);
  });
});
