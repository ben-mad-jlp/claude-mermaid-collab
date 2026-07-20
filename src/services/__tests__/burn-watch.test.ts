import { describe, it, expect, beforeEach } from 'bun:test';
import {
  runBurnWatchPass,
  shouldRunBurnWatchPass,
  _resetBurnWatchThrottle,
  BURN_WATCH_INTERVAL_MS,
  TOKEN_BURN_KIND,
  type BurnWatchDeps,
} from '../burn-watch.ts';
import type { BurnRow } from '../spend-ledger.ts';

const P = '/proj/burn';

const row = (source: string, calls: number): BurnRow => ({
  source, calls, inputTokens: calls * 100, outputTokens: calls * 20,
  cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, estCostUsd: 0,
});

/** Build deps with a canned gauge + a recording createEscalation spy. */
function deps(rows: BurnRow[], opts: { existingOpen?: boolean } = {}): { d: BurnWatchDeps; created: any[] } {
  const created: any[] = [];
  const d: BurnWatchDeps = {
    now: () => 5_000_000,
    getBurn: () => rows,
    createEsc: ((input: any) => {
      created.push(input);
      // isNew=false simulates an already-open (deduped) card.
      return { escalation: { id: 'e1', ...input }, isNew: !opts.existingOpen };
    }) as any,
  };
  return { d, created };
}

beforeEach(() => { _resetBurnWatchThrottle(); });

describe('runBurnWatchPass', () => {
  it('flags a NON-BUILD source over its ceiling with an operator-gated token-burn escalation', async () => {
    const { d, created } = deps([row('conductor', 30)]); // ceiling 8
    const r = await runBurnWatchPass(P, d);
    expect(r.flagged).toEqual(['conductor']);
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe(TOKEN_BURN_KIND);
    expect(created[0].operatorGated).toBe(true);
    expect(created[0].questionText).toContain('[burn:conductor]');
  });

  it('EXEMPTS build sources even when they burn heavily (expected work)', async () => {
    const { d, created } = deps([row('leaf', 999), row('review', 999)]);
    const r = await runBurnWatchPass(P, d);
    expect(r.flagged).toEqual([]);
    expect(created).toHaveLength(0);
  });

  it('does not double-flag when a card for the source is already open (dedup via isNew)', async () => {
    const { d, created } = deps([row('summary', 500)], { existingOpen: true });
    const r = await runBurnWatchPass(P, d);
    expect(created).toHaveLength(1); // createEscalation was called…
    expect(r.flagged).toEqual([]);   // …but it deduped (isNew=false) → not counted as newly flagged
  });

  it('is quiet when every source is under ceiling', async () => {
    const { d, created } = deps([row('conductor', 3), row('summary', 10)]);
    const r = await runBurnWatchPass(P, d);
    expect(r.flagged).toEqual([]);
    expect(created).toHaveLength(0);
  });

  it('never throws when the gauge read fails', async () => {
    const d: BurnWatchDeps = { getBurn: () => { throw new Error('db down'); } };
    const r = await runBurnWatchPass(P, d);
    expect(r.flagged).toEqual([]);
  });
});

describe('shouldRunBurnWatchPass throttle', () => {
  it('runs first call, skips within the interval, runs again after it', () => {
    const t = 1_000_000;
    expect(shouldRunBurnWatchPass(P, t)).toBe(true);
    expect(shouldRunBurnWatchPass(P, t + BURN_WATCH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldRunBurnWatchPass(P, t + BURN_WATCH_INTERVAL_MS + 1)).toBe(true);
  });
});
