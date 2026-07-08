import { test, expect } from 'bun:test';
import { computeMissionEconomics, ACCEPT_RATE_BREAK_EVEN } from '../mission-cost';
import type { LeafRunSummary } from '../ledger-stats';

function run(over: Partial<LeafRunSummary>): LeafRunSummary {
  return {
    leafId: 'l', project: '/p', epicId: 'e', finalOutcome: 'accepted', reviewVerdict: 'pass',
    reason: null, pathTaken: 'floor', lastTs: 1, nodesSpent: 5, costUsd: 1, ...over,
  };
}

test('empty ⇒ nulls (no runs, no rate)', () => {
  const r = computeMissionEconomics([]);
  expect(r.acceptRate).toBeNull();
  expect(r.costPerAcceptedChange).toBeNull();
  expect(r.nodesPerAcceptedChange).toBeNull();
  expect(r.belowBreakEven).toBeNull();
  expect(r.leaves).toEqual({ total: 0, accepted: 0, rejected: 0, blocked: 0, inflight: 0 });
});

test('sums cost + nodes across all runs (terminal AND inflight)', () => {
  const r = computeMissionEconomics([
    run({ costUsd: 2, nodesSpent: 5, finalOutcome: 'accepted' }),
    run({ costUsd: 3, nodesSpent: 20, finalOutcome: 'rejected' }),
    run({ costUsd: 1, nodesSpent: 4, finalOutcome: 'pending' }), // inflight, still counts cost
  ]);
  expect(r.costUsd).toBe(6);
  expect(r.nodesSpent).toBe(29);
  expect(r.leaves).toEqual({ total: 3, accepted: 1, rejected: 1, blocked: 0, inflight: 1 });
});

test('accept rate excludes inflight; cost/nodes-per-accepted use accepted count', () => {
  const r = computeMissionEconomics([
    run({ costUsd: 4, nodesSpent: 5, finalOutcome: 'accepted' }),
    run({ costUsd: 4, nodesSpent: 5, finalOutcome: 'accepted' }),
    run({ costUsd: 4, nodesSpent: 30, finalOutcome: 'blocked' }),
    run({ costUsd: 0, nodesSpent: 2, finalOutcome: 'paused' }), // inflight → ignored by rate
  ]);
  // 2 accepted of 3 terminal (accepted+blocked) = 0.666…
  expect(r.acceptRate).toBeCloseTo(2 / 3, 5);
  expect(r.costPerAcceptedChange).toBe(6); // 12 usd (ALL runs) / 2 accepted
  expect(r.nodesPerAcceptedChange).toBe(21); // 42 nodes (5+5+30+2, ALL runs) / 2 accepted
  expect(r.belowBreakEven).toBe(false);
});

test('below-break-even flag trips under the ~50% line', () => {
  const r = computeMissionEconomics([
    run({ finalOutcome: 'accepted' }),
    run({ finalOutcome: 'rejected' }),
    run({ finalOutcome: 'rejected' }),
  ]);
  expect(r.acceptRate).toBeCloseTo(1 / 3, 5);
  expect(r.acceptRate! < ACCEPT_RATE_BREAK_EVEN).toBe(true);
  expect(r.belowBreakEven).toBe(true);
});

test('costPerAcceptedChange is null when USD unknown (Max plan) but nodes-per still reported', () => {
  const r = computeMissionEconomics([
    run({ costUsd: 0, nodesSpent: 5, finalOutcome: 'accepted' }),
    run({ costUsd: 0, nodesSpent: 5, finalOutcome: 'accepted' }),
  ]);
  expect(r.costPerAcceptedChange).toBeNull(); // no price → don't report a misleading $0
  expect(r.nodesPerAcceptedChange).toBe(5);   // robust proxy still works
  expect(r.acceptRate).toBe(1);
});
