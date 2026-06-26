// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordPhase, queryLedger, summarize, _closeLedgerDb, setLeafInflight, listLeafInflight, isLeafInflightLive, clearLeafInflight, reapStaleInflight, reapSameEpochOrphanInflight, recordLeafResume, markLeafMerged, getLeafResume, clearLeafResume, type LedgerEntry } from '../worker-ledger';
import Database from 'bun:sqlite';

let dir: string;

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    project: '/p', todoId: 't1', session: 'lane-1', phase: 'implement',
    provider: 'grok-build', model: 'grok-build-0.1', source: 'default',
    inputTokens: 1000, outputTokens: 500, costUsd: 0.002, knownPrice: true, steps: 3,
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
});
afterEach(() => {
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('worker-ledger', () => {
  test('recordPhase persists and queryLedger returns newest-first', () => {
    expect(recordPhase(entry({ phase: 'research' }), 1000)).not.toBeNull();
    expect(recordPhase(entry({ phase: 'implement' }), 2000)).not.toBeNull();
    const rows = queryLedger({ project: '/p' });
    expect(rows.map((r) => r.phase)).toEqual(['implement', 'research']); // ts DESC
    expect(rows[0].knownPrice).toBe(true); // INTEGER 1 → boolean
  });

  test('filters by project / todoId / since', () => {
    recordPhase(entry({ project: '/a', todoId: 'x' }), 100);
    recordPhase(entry({ project: '/b', todoId: 'y' }), 200);
    recordPhase(entry({ project: '/b', todoId: 'z' }), 300);
    expect(queryLedger({ project: '/b' }).length).toBe(2);
    expect(queryLedger({ todoId: 'z' }).length).toBe(1);
    expect(queryLedger({ since: 250 }).length).toBe(1);
  });

  test('cache tokens round-trip through recordPhase, queryLedger, and summarize', () => {
    expect(
      recordPhase(entry({ phase: 'node', cacheReadTokens: 42000, cacheCreationTokens: 8000 }), 1000),
    ).not.toBeNull();
    const rows = queryLedger({ project: '/p' });
    expect(rows[0].cacheReadTokens).toBe(42000);
    expect(rows[0].cacheCreationTokens).toBe(8000);
    const s = summarize({ project: '/p' });
    expect(s.cacheReadTokens).toBe(42000);
    expect(s.cacheCreationTokens).toBe(8000);
    expect(s.byPhase.node.cacheReadTokens).toBe(42000);
    expect(s.byPhase.node.cacheCreationTokens).toBe(8000);
  });

  test('legacy rows without cache tokens summarize as 0 (no NaN)', () => {
    expect(recordPhase(entry({ phase: 'node' }), 1000)).not.toBeNull(); // no cache fields
    const s = summarize({ project: '/p' });
    expect(s.cacheReadTokens).toBe(0);
    expect(s.cacheCreationTokens).toBe(0);
  });

  test('summarize rolls up cost per phase and per model', () => {
    recordPhase(entry({ phase: 'research', model: 'claude-sonnet-4-6', provider: 'claude', costUsd: 0.01, inputTokens: 100, outputTokens: 50 }));
    recordPhase(entry({ phase: 'implement', model: 'grok-build-0.1', costUsd: 0.002, inputTokens: 1000, outputTokens: 500 }));
    recordPhase(entry({ phase: 'verify', model: 'claude-sonnet-4-6', provider: 'claude', costUsd: 0.008, inputTokens: 80, outputTokens: 40 }));
    const s = summarize({ project: '/p' });
    expect(s.rows).toBe(3);
    expect(s.totalUsd).toBeCloseTo(0.02, 6);
    expect(s.byPhase.research.usd).toBeCloseTo(0.01, 6);
    expect(s.byModel['claude-sonnet-4-6'].rows).toBe(2);
    expect(s.byModel['claude-sonnet-4-6'].usd).toBeCloseTo(0.018, 6);
    expect(s.byModel['grok-build-0.1'].rows).toBe(1);
  });

  test('unknown price is flagged in the per-model summary', () => {
    recordPhase(entry({ model: 'mystery-model', knownPrice: false, costUsd: 0 }));
    const s = summarize({ project: '/p' });
    expect(s.byModel['mystery-model'].unknownPrice).toBe(true);
  });

  test('epicId filter rolls up cost per epic', () => {
    recordPhase(entry({ todoId: 't1', epicId: 'E1', costUsd: 0.1 }));
    recordPhase(entry({ todoId: 't2', epicId: 'E1', costUsd: 0.2 }));
    recordPhase(entry({ todoId: 't3', epicId: 'E2', costUsd: 0.5 }));
    expect(queryLedger({ epicId: 'E1' }).length).toBe(2);
    expect(summarize({ epicId: 'E1' }).totalUsd).toBeCloseTo(0.3, 6);
    expect(summarize({ epicId: 'E2' }).totalUsd).toBeCloseTo(0.5, 6);
  });

  test('limit caps rows', () => {
    for (let i = 0; i < 5; i++) recordPhase(entry(), 1000 + i);
    expect(queryLedger({ limit: 3 }).length).toBe(3);
  });
});

describe('leaf_inflight epoch heal (reapStaleInflight)', () => {
  test('deletes rows from a dead process (foreign + NULL epoch), keeps this process\'s', () => {
    setLeafInflight({ project: '/p', leafId: 'live', nodeKind: 'implement' });
    // Simulate rows a now-dead daemon left: a foreign epoch + a legacy NULL epoch.
    const raw = new Database(join(dir, 'worker-ledger.db'));
    raw.prepare("INSERT INTO leaf_inflight (leafId, project, startedAt, epoch) VALUES ('dead', '/p', ?, 'old-epoch')").run(Date.now());
    raw.prepare("INSERT INTO leaf_inflight (leafId, project, startedAt, epoch) VALUES ('legacy', '/p', ?, NULL)").run(Date.now());
    raw.close();

    expect(reapStaleInflight()).toBe(2);
    expect(listLeafInflight().map((r) => r.leafId)).toEqual(['live']);
  });

  test('a row this process wrote survives its own reap', () => {
    setLeafInflight({ project: '/p', leafId: 'mine' });
    expect(reapStaleInflight()).toBe(0);
    expect(listLeafInflight().map((r) => r.leafId)).toContain('mine');
  });
});

describe('leaf_inflight same-epoch orphan sweep (E4 — reapSameEpochOrphanInflight)', () => {
  test('drops a current-epoch row whose run is not live; keeps live runs', () => {
    setLeafInflight({ project: '/p', leafId: 'live-run', nodeKind: 'blueprint' });
    setLeafInflight({ project: '/p', leafId: 'dead-run', nodeKind: 'implement' });
    // 'live-run' is still executing (e.g. between nodes); 'dead-run' errored without
    // clearing its row → a same-epoch phantom that reapStaleInflight can't touch.
    const live = new Set(['live-run']);
    expect(reapSameEpochOrphanInflight((id) => live.has(id))).toBe(1);
    expect(listLeafInflight().map((r) => r.leafId)).toEqual(['live-run']);
  });

  test('no live runs → drops every current-epoch row; idempotent', () => {
    setLeafInflight({ project: '/p', leafId: 'a' });
    setLeafInflight({ project: '/p', leafId: 'b' });
    expect(reapSameEpochOrphanInflight(() => false)).toBe(2);
    expect(listLeafInflight()).toEqual([]);
    expect(reapSameEpochOrphanInflight(() => false)).toBe(0);
  });
});

describe('leaf_resume durable budget recovery (slice 1b)', () => {
  test('records and reads back nodesSpent + phase + attempt', () => {
    recordLeafResume({ project: '/p', leafId: 'L1', nodesSpent: 7, phase: 'implement', attempt: 1 });
    const r = getLeafResume('/p', 'L1');
    expect(r?.nodesSpent).toBe(7);
    expect(r?.phase).toBe('implement');
    expect(r?.attempt).toBe(1);
    expect(r?.merged).toBe(false);
  });

  test('survives a simulated process death (NOT epoch-reaped, unlike inflight)', () => {
    recordLeafResume({ project: '/p', leafId: 'L1', nodesSpent: 12, phase: 'review' });
    // reapStaleInflight would wipe a foreign-epoch inflight row; resume must persist.
    reapStaleInflight();
    expect(getLeafResume('/p', 'L1')?.nodesSpent).toBe(12);
  });

  test('per-node upsert advances nodesSpent but preserves the merged flag + epicBaseSha', () => {
    recordLeafResume({ project: '/p', leafId: 'L1', nodesSpent: 3, phase: 'blueprint', epicBaseSha: 'abc123' });
    markLeafMerged('L1');
    recordLeafResume({ project: '/p', leafId: 'L1', nodesSpent: 4, phase: 'review' }); // later node, no sha passed
    const r = getLeafResume('/p', 'L1');
    expect(r?.nodesSpent).toBe(4);
    expect(r?.merged).toBe(true); // preserved across the upsert
    expect(r?.epicBaseSha).toBe('abc123'); // COALESCEd, not clobbered
  });

  test('clearLeafResume removes the row (terminal outcome)', () => {
    recordLeafResume({ project: '/p', leafId: 'L1', nodesSpent: 5 });
    clearLeafResume('L1');
    expect(getLeafResume('/p', 'L1')).toBeNull();
  });

  test('getLeafResume is project-scoped', () => {
    recordLeafResume({ project: '/a', leafId: 'L1', nodesSpent: 9 });
    expect(getLeafResume('/b', 'L1')).toBeNull();
    expect(getLeafResume('/a', 'L1')?.nodesSpent).toBe(9);
  });
});

describe('isLeafInflightLive', () => {
  test('returns true for a same-epoch setLeafInflight row; false after clear; false for unknown', () => {
    expect(isLeafInflightLive('L1')).toBe(false);
    setLeafInflight({ project: '/p', leafId: 'L1', nodeKind: 'implement' });
    expect(isLeafInflightLive('L1')).toBe(true);
    expect(isLeafInflightLive('L2')).toBe(false);
    clearLeafInflight('L1');
    expect(isLeafInflightLive('L1')).toBe(false);
  });
});
