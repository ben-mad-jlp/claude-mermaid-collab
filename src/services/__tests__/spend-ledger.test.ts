import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the worker-ledger DB (which spend-ledger writes through) before importing.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'spend-'));

import {
  recordSpend,
  getBurnBySource,
  detectBurnLeaks,
  normalizeModelId,
  DEFAULT_BURN_THRESHOLDS,
  type BurnRow,
} from '../spend-ledger.ts';
import { _closeLedgerDb } from '../worker-ledger.ts';

const P = '/proj/spend';

beforeAll(() => { _closeLedgerDb(); });

describe('recordSpend → getBurnBySource roundtrip', () => {
  it('groups calls by source with accurate call counts + token sums', () => {
    const t = 1_000_000;
    recordSpend({ project: P, source: 'conductor', model: 'opus', usage: { inputTokens: 100, outputTokens: 50 } }, t);
    recordSpend({ project: P, source: 'conductor', model: 'opus', usage: { inputTokens: 200, outputTokens: 10 } }, t + 1);
    recordSpend({ project: P, source: 'summary', model: 'sonnet', usage: { inputTokens: 5, outputTokens: 5 } }, t + 2);

    const rows = getBurnBySource({ project: P, sinceMs: t - 1 });
    const cond = rows.find((r) => r.source === 'conductor')!;
    const summ = rows.find((r) => r.source === 'summary')!;
    expect(cond.calls).toBe(2);
    expect(cond.inputTokens).toBe(300);
    expect(cond.outputTokens).toBe(60);
    expect(summ.calls).toBe(1);
  });

  it('records a row even for a zero-usage call (a killed node still counts as a CALL)', () => {
    const t = 2_000_000;
    recordSpend({ project: P, source: 'timeout-src', model: 'opus', usage: undefined }, t);
    const rows = getBurnBySource({ project: P, sinceMs: t - 1 });
    const r = rows.find((x) => x.source === 'timeout-src')!;
    expect(r.calls).toBe(1);
    expect(r.inputTokens).toBe(0);
  });

  it('estimates USD from tokens × price when the provider omits costUsd (the Max-plan case)', () => {
    const t = 3_000_000;
    // opus = $15/Mtok in, $75/Mtok out → 1e6 in + 1e6 out = 15 + 75 = $90.
    recordSpend({ project: P, source: 'estcost', model: 'opus', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } }, t);
    const r = getBurnBySource({ project: P, sinceMs: t - 1 }).find((x) => x.source === 'estcost')!;
    expect(r.estCostUsd).toBeCloseTo(90, 5);
  });

  it('prefers a provider-reported costUsd over the token estimate', () => {
    const t = 4_000_000;
    recordSpend({ project: P, source: 'provcost', model: 'opus', usage: { inputTokens: 1_000_000, outputTokens: 0, costUsd: 1.23 } }, t);
    const r = getBurnBySource({ project: P, sinceMs: t - 1 }).find((x) => x.source === 'provcost')!;
    expect(r.estCostUsd).toBeCloseTo(1.23, 5);
  });
});

describe('normalizeModelId', () => {
  it('maps aliases to priced ids and passes full ids through', () => {
    expect(normalizeModelId('opus')).toBe('claude-opus-4-8');
    expect(normalizeModelId('sonnet')).toBe('claude-sonnet-4-6');
    expect(normalizeModelId('claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(normalizeModelId(undefined)).toBeUndefined();
  });
});

describe('detectBurnLeaks (pure)', () => {
  const row = (source: string, calls: number): BurnRow => ({
    source, calls, inputTokens: calls * 10, outputTokens: calls * 2,
    cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, estCostUsd: 0,
  });

  it('flags a source over its ceiling', () => {
    const leaks = detectBurnLeaks([row('conductor', 20)]); // ceiling 8
    expect(leaks).toHaveLength(1);
    expect(leaks[0].source).toBe('conductor');
    expect(leaks[0].ceiling).toBe(DEFAULT_BURN_THRESHOLDS.maxCallsPerWindow.conductor);
  });

  it('does NOT flag a source at/under its ceiling', () => {
    expect(detectBurnLeaks([row('conductor', 8)])).toHaveLength(0);
  });

  it('exempts a productive source even when over ceiling', () => {
    const leaks = detectBurnLeaks([row('leaf', 500)], { productiveSources: new Set(['leaf']) });
    expect(leaks).toHaveLength(0);
  });

  it('ranks the worst breach (calls/ceiling) first', () => {
    const leaks = detectBurnLeaks([row('summary', 120), row('conductor', 40)]); // 2x vs 5x ceiling
    expect(leaks[0].source).toBe('conductor');
  });
});
