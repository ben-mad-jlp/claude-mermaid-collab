import { describe, test, expect } from 'bun:test';
import {
  REPAIR_FORGE_SESSION,
  isAutoForgedRepairMission,
  REPAIR_BATCH_K,
  REPAIR_AGE_MS,
  REPAIR_BUDGET_USD,
  selectRepairBatch,
  buildRepairMissionSpec,
  type RepairRequest,
} from '../repair-mission-forge';

describe('repair-mission-forge module', () => {
  test('isAutoForgedRepairMission recognizes the synthetic session marker', () => {
    expect(isAutoForgedRepairMission({ ownerSession: REPAIR_FORGE_SESSION })).toBe(true);
    expect(isAutoForgedRepairMission({ ownerSession: 'other-session' })).toBe(false);
    expect(isAutoForgedRepairMission({ ownerSession: null })).toBe(false);
    expect(isAutoForgedRepairMission({})).toBe(false);
  });

  test('REPAIR_BATCH_K is 5', () => {
    expect(REPAIR_BATCH_K).toBe(5);
  });

  test('REPAIR_AGE_MS is 72 hours', () => {
    expect(REPAIR_AGE_MS).toBe(72 * 60 * 60 * 1000);
  });

  test('REPAIR_BUDGET_USD is a finite number', () => {
    expect(typeof REPAIR_BUDGET_USD).toBe('number');
    expect(isFinite(REPAIR_BUDGET_USD)).toBe(true);
    expect(REPAIR_BUDGET_USD).toBe(25);
  });

  test('criteria deep-equal the input fixedMeans strings verbatim', () => {
    const now = Date.now();
    const ageMs = REPAIR_AGE_MS;

    const requests: RepairRequest[] = [
      {
        id: 'req-1',
        title: 'Request 1',
        bugfixSpec: {
          observedFailure: 'Failure A',
          evidence: 'Evidence A',
          fixedMeans: '  leading space and trailing space  ', // preserved exactly
        },
        createdAt: new Date(now - ageMs - 1000).toISOString(),
      },
      {
        id: 'req-2',
        title: 'Request 2',
        bugfixSpec: {
          observedFailure: 'Failure B',
          evidence: 'Evidence B',
          fixedMeans: 'Fixed B\nwith newline', // newline preserved
        },
        createdAt: new Date(now - ageMs - 2000).toISOString(),
      },
      {
        id: 'req-3',
        title: 'Request 3',
        bugfixSpec: {
          observedFailure: 'Failure C',
          evidence: 'Evidence C',
          fixedMeans: '`backticks` and "quotes"', // punctuation preserved
        },
        createdAt: new Date(now - ageMs - 3000).toISOString(),
      },
    ];

    const batch = selectRepairBatch(requests, { k: REPAIR_BATCH_K, ageMs, now });
    expect(batch).not.toBeNull();
    expect(batch!.length).toBe(3);

    const spec = buildRepairMissionSpec(batch!);
    expect(spec.criteria).toEqual([
      '`backticks` and "quotes"',
      'Fixed B\nwith newline',
      '  leading space and trailing space  ',
    ]);
  });

  test('4 fresh requests return null', () => {
    const now = Date.now();
    const requests: RepairRequest[] = [
      {
        id: 'r1',
        bugfixSpec: {
          observedFailure: 'F1',
          evidence: 'E1',
          fixedMeans: 'Fixed 1',
        },
        createdAt: new Date(now - 1000).toISOString(),
      },
      {
        id: 'r2',
        bugfixSpec: {
          observedFailure: 'F2',
          evidence: 'E2',
          fixedMeans: 'Fixed 2',
        },
        createdAt: new Date(now - 2000).toISOString(),
      },
      {
        id: 'r3',
        bugfixSpec: {
          observedFailure: 'F3',
          evidence: 'E3',
          fixedMeans: 'Fixed 3',
        },
        createdAt: new Date(now - 3000).toISOString(),
      },
      {
        id: 'r4',
        bugfixSpec: {
          observedFailure: 'F4',
          evidence: 'E4',
          fixedMeans: 'Fixed 4',
        },
        createdAt: new Date(now - 4000).toISOString(),
      },
    ];

    expect(selectRepairBatch(requests, { now })).toBeNull();
  });

  test('5 fresh requests return the batch', () => {
    const now = Date.now();
    const requests: RepairRequest[] = [];
    for (let i = 1; i <= 5; i++) {
      requests.push({
        id: `r${i}`,
        bugfixSpec: {
          observedFailure: `Failure ${i}`,
          evidence: `Evidence ${i}`,
          fixedMeans: `Fixed ${i}`,
        },
        createdAt: new Date(now - i * 1000).toISOString(),
      });
    }

    const batch = selectRepairBatch(requests, { now });
    expect(batch).not.toBeNull();
    expect(batch!.length).toBe(5);
    expect(batch!.map((b) => b.request.id)).toEqual(['r5', 'r4', 'r3', 'r2', 'r1']); // sorted by createdAt asc
  });

  test('a single request aged 73h returns the batch', () => {
    const now = Date.now();
    const ageMs = 73 * 60 * 60 * 1000; // 73 hours

    const requests: RepairRequest[] = [
      {
        id: 'aged-req',
        bugfixSpec: {
          observedFailure: 'Old failure',
          evidence: 'Old evidence',
          fixedMeans: 'Old fix',
        },
        createdAt: new Date(now - ageMs).toISOString(),
      },
    ];

    const batch = selectRepairBatch(requests, { k: 5, ageMs: REPAIR_AGE_MS, now });
    expect(batch).not.toBeNull();
    expect(batch!.length).toBe(1);
    expect(batch![0].request.id).toBe('aged-req');
  });

  test('budgetUsd is non-null on every built spec', () => {
    const now = Date.now();

    // Count-triggered batch (5 fresh requests)
    const countTriggered: RepairRequest[] = [];
    for (let i = 1; i <= 5; i++) {
      countTriggered.push({
        id: `count-r${i}`,
        bugfixSpec: {
          observedFailure: `F${i}`,
          evidence: `E${i}`,
          fixedMeans: `Fixed ${i}`,
        },
        createdAt: new Date(now - i * 1000).toISOString(),
      });
    }

    const countBatch = selectRepairBatch(countTriggered, { now });
    expect(countBatch).not.toBeNull();

    const countSpec = buildRepairMissionSpec(countBatch!);
    expect(countSpec.budgetUsd).not.toBeNull();
    expect(typeof countSpec.budgetUsd).toBe('number');
    expect(isFinite(countSpec.budgetUsd)).toBe(true);

    // Age-triggered batch (1 old request)
    const ageMs = 73 * 60 * 60 * 1000;
    const ageTriggered: RepairRequest[] = [
      {
        id: 'age-r1',
        bugfixSpec: {
          observedFailure: 'Old F',
          evidence: 'Old E',
          fixedMeans: 'Old Fixed',
        },
        createdAt: new Date(now - ageMs).toISOString(),
      },
    ];

    const ageBatch = selectRepairBatch(ageTriggered, { k: 5, ageMs: REPAIR_AGE_MS, now });
    expect(ageBatch).not.toBeNull();

    const ageSpec = buildRepairMissionSpec(ageBatch!);
    expect(ageSpec.budgetUsd).not.toBeNull();
    expect(typeof ageSpec.budgetUsd).toBe('number');
    expect(isFinite(ageSpec.budgetUsd)).toBe(true);
  });

  test('requests with an unrecoverable fixedMeans are excluded, never blanked', () => {
    const now = Date.now();

    const requests: RepairRequest[] = [
      {
        id: 'good-1',
        bugfixSpec: {
          observedFailure: 'F1',
          evidence: 'E1',
          fixedMeans: 'Fixed 1',
        },
        createdAt: new Date(now - 1000).toISOString(),
      },
      {
        id: 'bad-1',
        // no bugfixSpec, no legacy prose
        description: 'Just a plain description',
        createdAt: new Date(now - 2000).toISOString(),
      },
      {
        id: 'good-2',
        bugfixSpec: {
          observedFailure: 'F2',
          evidence: 'E2',
          fixedMeans: 'Fixed 2',
        },
        createdAt: new Date(now - 3000).toISOString(),
      },
      {
        id: 'bad-2',
        // no bugfixSpec, no legacy prose
        description: 'Another plain description',
        createdAt: new Date(now - 4000).toISOString(),
      },
      {
        id: 'good-3',
        bugfixSpec: {
          observedFailure: 'F3',
          evidence: 'E3',
          fixedMeans: 'Fixed 3',
        },
        createdAt: new Date(now - 5000).toISOString(),
      },
    ];

    // With 5 total requests but only 3 recoverable, should return null (3 < k=5)
    const batch1 = selectRepairBatch(requests, { now });
    expect(batch1).toBeNull();

    // Add an aged request to trigger by age instead
    const aged: RepairRequest[] = [
      ...requests,
      {
        id: 'aged-good',
        bugfixSpec: {
          observedFailure: 'Aged F',
          evidence: 'Aged E',
          fixedMeans: 'Aged Fixed',
        },
        createdAt: new Date(now - REPAIR_AGE_MS - 1000).toISOString(),
      },
    ];

    const batch2 = selectRepairBatch(aged, { now });
    expect(batch2).not.toBeNull();

    // Should contain only recoverable items (4 total after adding aged)
    const recoverable = batch2!;
    expect(recoverable.length).toBeLessThanOrEqual(REPAIR_BATCH_K);
    for (const item of recoverable) {
      expect(item.spec).toBeTruthy();
      expect(item.spec.fixedMeans).toBeTruthy();
      expect(item.spec.fixedMeans).not.toBe('');
    }

    // Verify spec doesn't have blank criteria
    const spec = buildRepairMissionSpec(recoverable);
    expect(spec.criteria.every((c) => c.length > 0)).toBe(true);
    expect(spec.criteria).not.toContain('');
  });
});
