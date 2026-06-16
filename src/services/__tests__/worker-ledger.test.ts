// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordPhase, queryLedger, summarize, _closeLedgerDb, type LedgerEntry } from '../worker-ledger';

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

  test('limit caps rows', () => {
    for (let i = 0; i < 5; i++) recordPhase(entry(), 1000 + i);
    expect(queryLedger({ limit: 3 }).length).toBe(3);
  });
});
