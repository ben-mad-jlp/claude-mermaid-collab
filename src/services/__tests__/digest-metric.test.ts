// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordNode, _closeLedgerDb } from '../worker-ledger';
import { digestMetricReport } from '../digest-metric';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'digest-metric-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
});

afterEach(() => {
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('digest-metric', () => {
  test('aggregates blueprint metrics before/after enabledAt with reject-rate correlation', () => {
    const enabledAt = 1_000_000_000_000;
    const project = '/test-project';

    // BEFORE bucket (ts < enabledAt)
    // Two blueprint rows with different cache reads
    const leafId1 = 'leaf-1';
    const leafId2 = 'leaf-2';

    // Blueprint row 1: cacheReadTokens=1000, nodesSpent=1, BEFORE
    recordNode(
      {
        project,
        todoId: 'todo-1',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId: leafId1,
        cacheReadTokens: 1000,
        nodesSpent: 1,
      },
      enabledAt - 1000, // before enabledAt
    );

    // Blueprint row 2: cacheReadTokens=3000, nodesSpent=1, BEFORE
    recordNode(
      {
        project,
        todoId: 'todo-2',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId: leafId2,
        cacheReadTokens: 3000,
        nodesSpent: 1,
      },
      enabledAt - 500, // before enabledAt
    );

    // Outcome marker for leafId1: rejected (so leafId1 is in rejectedSet)
    recordNode(
      {
        project,
        todoId: 'todo-1',
        session: 'session-1',
        nodeKind: 'outcome',
        leafId: leafId1,
        leafOutcome: 'rejected',
      },
      enabledAt - 200,
    );

    // AFTER bucket (ts >= enabledAt)
    // Two blueprint rows, both accepted
    const leafId3 = 'leaf-3';
    const leafId4 = 'leaf-4';

    // Blueprint row 3: cacheReadTokens=500, nodesSpent=1, AFTER
    recordNode(
      {
        project,
        todoId: 'todo-3',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId: leafId3,
        cacheReadTokens: 500,
        nodesSpent: 1,
      },
      enabledAt + 1000, // at/after enabledAt
    );

    // Blueprint row 4: cacheReadTokens=500, nodesSpent=1, AFTER
    recordNode(
      {
        project,
        todoId: 'todo-4',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId: leafId4,
        cacheReadTokens: 500,
        nodesSpent: 1,
      },
      enabledAt + 500, // at/after enabledAt
    );

    // Outcome markers for AFTER leaves: accepted
    recordNode(
      {
        project,
        todoId: 'todo-3',
        session: 'session-1',
        nodeKind: 'outcome',
        leafId: leafId3,
        leafOutcome: 'accepted',
      },
      enabledAt + 1500,
    );

    recordNode(
      {
        project,
        todoId: 'todo-4',
        session: 'session-1',
        nodeKind: 'outcome',
        leafId: leafId4,
        leafOutcome: 'accepted',
      },
      enabledAt + 2000,
    );

    const report = digestMetricReport(project, { enabledAt, windowDays: 1 });

    // Validate BEFORE metrics
    // beforeRuns = 2 (two blueprint rows)
    expect(report.counts.beforeRuns).toBe(2);
    // avgCacheRead = (1000 + 3000) / 2 = 2000
    expect(report.avgCacheRead.before).toBe(2000);
    // avgNodesSpent = (1 + 1) / 2 = 1
    expect(report.avgNodesSpent.before).toBe(1);
    // rejectRate = 1 / 2 = 0.5 (leafId1 is rejected, leafId2 is not)
    expect(report.rejectRate.before).toBe(0.5);

    // Validate AFTER metrics
    // afterRuns = 2 (two blueprint rows)
    expect(report.counts.afterRuns).toBe(2);
    // avgCacheRead = (500 + 500) / 2 = 500
    expect(report.avgCacheRead.after).toBe(500);
    // avgNodesSpent = (1 + 1) / 2 = 1
    expect(report.avgNodesSpent.after).toBe(1);
    // rejectRate = 0 / 2 = 0 (no rejected leaves)
    expect(report.rejectRate.after).toBe(0);

    // Validate deltaPct
    // avgCacheRead: (500 - 2000) / 2000 * 100 = -75%
    expect(report.avgCacheRead.deltaPct).toBe(-75);
    // avgNodesSpent: (1 - 1) / 1 * 100 = 0%
    expect(report.avgNodesSpent.deltaPct).toBe(0);
    // rejectRate: (0 - 0.5) / 0.5 * 100 = -100%
    expect(report.rejectRate.deltaPct).toBe(-100);
  });

  test('handles reject-rate via attempts > 1 in outcomeDetail', () => {
    const enabledAt = 1_000_000_000_000;
    const project = '/test-project-2';
    const leafId = 'leaf-attempts';

    // Blueprint row with 2 attempts indicated in outcomeDetail
    recordNode(
      {
        project,
        todoId: 'todo-1',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId,
        cacheReadTokens: 1000,
        nodesSpent: 2,
      },
      enabledAt - 500,
    );

    // Outcome marker with attempts=2 in JSON
    recordNode(
      {
        project,
        todoId: 'todo-1',
        session: 'session-1',
        nodeKind: 'outcome',
        leafId,
        leafOutcome: 'accepted',
        outcomeDetail: JSON.stringify({ attempts: 2, nodesSpent: 2 }),
      },
      enabledAt - 100,
    );

    const report = digestMetricReport(project, { enabledAt, windowDays: 1 });

    // The leaf should be marked as rejected due to attempts > 1
    expect(report.counts.beforeRuns).toBe(1);
    expect(report.rejectRate.before).toBe(1); // 1 rejected out of 1 blueprint row
  });

  test('digest-refresh node detection and cost aggregation', () => {
    const enabledAt = 1_000_000_000_000;
    const project = '/test-project-3';

    // Regular blueprint row
    recordNode(
      {
        project,
        todoId: 'todo-1',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId: 'leaf-1',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
      },
      enabledAt - 1000,
    );

    // Digest-refresh row
    recordNode(
      {
        project,
        todoId: 'todo-refresh',
        session: 'session-1',
        nodeKind: 'digest-refresh',
        leafId: 'leaf-refresh',
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 1000,
        cacheCreationTokens: 100,
        costUsd: 0.15,
      },
      enabledAt + 100,
    );

    const report = digestMetricReport(project, { enabledAt, windowDays: 1 });

    // refreshCost should be identified and sum tokens
    expect(report.refreshCost.identified).toBe(true);
    expect(report.refreshCost.note).toBe('');
    expect(report.refreshCost.tokens).toBe(500 + 200 + 1000 + 100); // input+output+cacheRead+cacheCreation
    expect(report.refreshCost.costUsd).toBeCloseTo(0.15, 6);
  });

  test('returns unidentified refreshCost when no digest-refresh rows exist', () => {
    const enabledAt = 1_000_000_000_000;
    const project = '/test-project-4';

    // Only blueprint row, no refresh
    recordNode(
      {
        project,
        todoId: 'todo-1',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId: 'leaf-1',
        cacheReadTokens: 1000,
      },
      enabledAt - 500,
    );

    const report = digestMetricReport(project, { enabledAt, windowDays: 1 });

    expect(report.refreshCost.identified).toBe(false);
    expect(report.refreshCost.tokens).toBe(0);
    expect(report.refreshCost.costUsd).toBe(0);
    expect(report.refreshCost.note).toContain('no digest-refresh ledger rows found');
  });

  test('returns null deltaPct when before=0 (no baseline)', () => {
    const enabledAt = 1_000_000_000_000;
    const project = '/test-project-5';

    // Only AFTER rows, no BEFORE rows
    recordNode(
      {
        project,
        todoId: 'todo-1',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId: 'leaf-1',
        cacheReadTokens: 500,
      },
      enabledAt + 1000,
    );

    const report = digestMetricReport(project, { enabledAt, windowDays: 1 });

    expect(report.counts.beforeRuns).toBe(0);
    expect(report.avgCacheRead.before).toBe(0);
    expect(report.avgCacheRead.after).toBe(500);
    expect(report.avgCacheRead.deltaPct).toBeNull(); // no baseline to compare
  });

  test('respects windowDays parameter', () => {
    const enabledAt = 1_000_000_000_000;
    const project = '/test-project-6';
    const windowDays = 7;

    // Blueprint row well outside window (more than 7 days after)
    recordNode(
      {
        project,
        todoId: 'todo-1',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId: 'leaf-1',
        cacheReadTokens: 1000,
      },
      enabledAt + windowDays * 86_400_000 + 10_000,
    );

    // Blueprint row inside window
    recordNode(
      {
        project,
        todoId: 'todo-2',
        session: 'session-1',
        nodeKind: 'blueprint',
        leafId: 'leaf-2',
        cacheReadTokens: 2000,
      },
      enabledAt + 1000,
    );

    const report = digestMetricReport(project, { enabledAt, windowDays });

    // Only the row inside window should be counted
    expect(report.counts.afterRuns).toBe(1);
    expect(report.avgCacheRead.after).toBe(2000);
    expect(report.window.windowDays).toBe(windowDays);
  });

  test('multi-row refresh cost aggregation', () => {
    const enabledAt = 1_000_000_000_000;
    const project = '/test-project-7';

    // Multiple refresh nodes with different patterns
    recordNode(
      {
        project,
        todoId: 'todo-1',
        session: 'session-1',
        nodeKind: 'refresh-digest',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.05,
      },
      enabledAt - 500,
    );

    recordNode(
      {
        project,
        todoId: 'todo-2',
        session: 'session-1',
        nodeKind: 'digest_refresh',
        inputTokens: 200,
        outputTokens: 100,
        costUsd: 0.1,
      },
      enabledAt + 500,
    );

    const report = digestMetricReport(project, { enabledAt, windowDays: 1 });

    // Both should be identified and summed
    expect(report.refreshCost.identified).toBe(true);
    expect(report.refreshCost.tokens).toBe(100 + 50 + 200 + 100);
    expect(report.refreshCost.costUsd).toBeCloseTo(0.15, 6);
  });
});
