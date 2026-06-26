// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordNode, _closeLedgerDb, type LedgerEntry } from '../worker-ledger';
import { getLeafRun, getFleetStats } from '../ledger-stats';
import { NODE_BUDGET } from '../leaf-executor';

let dir: string;

/** Seed one node row with sane defaults. ts is explicit so ordering is deterministic. */
function node(over: Partial<LedgerEntry> & { leafId: string; ts: number }): void {
  const { ts, ...rest } = over;
  recordNode(
    {
      project: '/p',
      todoId: over.leafId,
      session: 'lane',
      authMode: 'subscription',
      nodeKind: 'implement',
      model: 'sonnet',
      nodesSpent: 1,
      ...rest,
    },
    ts,
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-stats-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
});
afterEach(() => {
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('getLeafRun', () => {
  test('surfaces per-node parseError + exitCode (the why behind a blocked leaf)', () => {
    // A blueprint node killed by timeout — exitCode 143 (SIGTERM) + the parseError
    // message. Exactly the T14 case: leaf_inspect must show WHY, not just 143.
    node({
      leafId: 'LX', ts: 1000, nodeKind: 'blueprint', model: 'opus',
      exitCode: 143, durationMs: 47000, parseError: 'node timed out after 600000ms (killed)',
    });
    const run = getLeafRun('LX');
    expect(run).not.toBeNull();
    expect(run!.nodes[0].exitCode).toBe(143);
    expect(run!.nodes[0].parseError).toBe('node timed out after 600000ms (killed)');
  });

  test('chronological order, attempts, nodesSpent/budget, wall-clock, verdict', () => {
    // A 2-attempt run: 2 blueprints (each starts an attempt) + impl + review, then
    // a terminal outcome marker carrying verdict+outcome.
    node({ leafId: 'L1', ts: 1000, nodeKind: 'blueprint', model: 'opus', durationMs: 100 });
    node({ leafId: 'L1', ts: 2000, nodeKind: 'implement', durationMs: 200 });
    node({ leafId: 'L1', ts: 3000, nodeKind: 'review', model: 'opus', durationMs: 50 });
    node({ leafId: 'L1', ts: 4000, nodeKind: 'blueprint', model: 'opus', durationMs: 100 });
    node({ leafId: 'L1', ts: 5000, nodeKind: 'review', model: 'opus', durationMs: 60 });
    node({
      leafId: 'L1', ts: 6000, nodeKind: 'outcome', model: '', nodesSpent: 0,
      verdict: 'pass', leafOutcome: 'accepted',
    });

    const run = getLeafRun('L1');
    expect(run).not.toBeNull();
    // chronological, marker excluded from the node list
    expect(run!.nodes.map((n) => n.nodeKind)).toEqual([
      'blueprint', 'implement', 'review', 'blueprint', 'review',
    ]);
    expect(run!.attempts).toBe(2); // 2 blueprint rows
    expect(run!.nodesSpent).toBe(5); // 5 node rows × 1 (marker is 0 and excluded)
    expect(run!.nodeBudget).toBe(NODE_BUDGET);
    expect(run!.budgetPct).toBeCloseTo(5 / NODE_BUDGET);
    expect(run!.wallClockMs).toBe(6000 - 1000); // last ts (marker) − first ts
    expect(run!.reviewVerdict).toBe('pass');
    expect(run!.finalOutcome).toBe('accepted');
    expect(run!.authModes).toEqual({ subscription: 5 });
  });

  test('re-run: scopes to the latest run only', () => {
    // Run 1: blueprint + implement + terminal (rejected). ts in ms.
    node({ leafId: 'L1', ts: 1_000, nodeKind: 'blueprint', model: 'opus', durationMs: 100 });
    node({ leafId: 'L1', ts: 2_000, nodeKind: 'implement', durationMs: 200 });
    node({ leafId: 'L1', ts: 3_000, nodeKind: 'outcome', model: '', nodesSpent: 0, verdict: 'fail', leafOutcome: 'rejected' });
    // Run 2: starts well after RUN_GAP_MS (120s) — blueprint + implement + review + accepted.
    const t = 3_000 + 200_000;
    node({ leafId: 'L1', ts: t,          nodeKind: 'blueprint', model: 'opus', durationMs: 100 });
    node({ leafId: 'L1', ts: t + 1_000,  nodeKind: 'implement', durationMs: 200 });
    node({ leafId: 'L1', ts: t + 2_000,  nodeKind: 'review', model: 'opus', durationMs: 50 });
    node({ leafId: 'L1', ts: t + 3_000,  nodeKind: 'outcome', model: '', nodesSpent: 0, verdict: 'pass', leafOutcome: 'accepted' });

    const run = getLeafRun('L1');
    expect(run).not.toBeNull();
    // Only run 2's 3 node rows — run 1 excluded.
    expect(run!.nodes.map((n) => n.nodeKind)).toEqual(['blueprint', 'implement', 'review']);
    expect(run!.nodesSpent).toBe(3);
    expect(run!.attempts).toBe(1);            // one blueprint in run 2
    expect(run!.wallClockMs).toBe(3_000);     // (t+3000) − t, NOT spanning run 1
    expect(run!.reviewVerdict).toBe('pass');  // run 2 terminal, not run 1's 'fail'
    expect(run!.finalOutcome).toBe('accepted');
    expect(run!.authModes).toEqual({ subscription: 3 });
  });

  test('rate-limited count + null for unknown leaf', () => {
    node({ leafId: 'L2', ts: 100, nodeKind: 'blueprint', model: 'opus', rateLimited: true });
    const run = getLeafRun('L2');
    expect(run!.rateLimitedCount).toBe(1);
    expect(getLeafRun('nope')).toBeNull();
  });

  test('cache-token rollup sums cacheRead/cacheCreation across nodes (todo 7c6b7289)', () => {
    node({ leafId: 'L3', ts: 100, nodeKind: 'blueprint', model: 'opus', cacheReadTokens: 200_000, cacheCreationTokens: 20_000 });
    node({ leafId: 'L3', ts: 200, nodeKind: 'implement', cacheReadTokens: 150_000, cacheCreationTokens: 10_000 });
    node({ leafId: 'L3', ts: 300, nodeKind: 'review', model: 'opus', cacheReadTokens: 50_000 }); // creation null → 0
    const run = getLeafRun('L3');
    expect(run!.totalCacheReadTokens).toBe(400_000);
    expect(run!.totalCacheCreationTokens).toBe(30_000);
  });
});

describe('getFleetStats', () => {
  test('averages, authMode audit/alarm, cap-pause, block-rate, wall-clock', () => {
    // L1: clean 3-node subscription run, accepted.
    node({ leafId: 'L1', ts: 1000, nodeKind: 'blueprint', model: 'opus', durationMs: 100 });
    node({ leafId: 'L1', ts: 1500, nodeKind: 'implement', durationMs: 100 });
    node({ leafId: 'L1', ts: 2000, nodeKind: 'review', model: 'opus', durationMs: 100 });
    node({ leafId: 'L1', ts: 2100, nodeKind: 'outcome', model: '', nodesSpent: 0, leafOutcome: 'accepted' });
    // L2: an 'api' authMode row (ALARM) + a rate-limited row, blocked.
    node({ leafId: 'L2', ts: 1000, nodeKind: 'blueprint', model: 'opus', authMode: 'api', durationMs: 100 });
    node({ leafId: 'L2', ts: 1300, nodeKind: 'implement', rateLimited: true, durationMs: 300 });
    node({ leafId: 'L2', ts: 1400, nodeKind: 'outcome', model: '', nodesSpent: 0, leafOutcome: 'blocked' });

    const fs = getFleetStats({});
    expect(fs.leafCount).toBe(2);
    // L1=3 nodes, L2=2 nodes → avg 2.5
    expect(fs.nodesPerLeafAvg).toBeCloseTo(2.5);
    expect(fs.attemptRate).toBeCloseTo(1); // 1 blueprint each
    expect(fs.authModeAudit).toEqual({ subscription: 4, api: 1 });
    expect(fs.authModeAlarm).toBe(true); // an api row present
    expect(fs.capPauseCount).toBe(1);
    expect(fs.capPauseMs).toBe(300);
    expect(fs.blockRate).toBeCloseTo(0.5); // 1 of 2 blocked
    expect(fs.wallClock.max).toBe(2100 - 1000); // L1 span
  });

  test('alarm false when all subscription; project filter', () => {
    node({ leafId: 'A', ts: 100, nodeKind: 'blueprint', model: 'opus', project: '/x', todoId: 'A' });
    node({ leafId: 'B', ts: 100, nodeKind: 'blueprint', model: 'opus', project: '/y', todoId: 'B' });
    expect(getFleetStats({ project: '/x' }).leafCount).toBe(1);
    expect(getFleetStats({}).authModeAlarm).toBe(false);
  });
});
