import { describe, it, expect } from 'bun:test';
import { createCachedSweepState, runCachedSweep, type VerdictStore } from '../sweep-verdict-cache';

/** In-memory fake VerdictStore for tests — avoids touching the real worker-ledger DB and
 *  records every call so a test can assert on it directly. */
function fakeStore(): VerdictStore & {
  rows: Map<string, { tip: string; verdict: boolean }>;
  retireCalls: Array<{ sweepKind: string; id: string }>;
  putCalls: Array<{ sweepKind: string; id: string; tip: string; verdict: boolean }>;
} {
  const rows = new Map<string, { tip: string; verdict: boolean }>();
  const retireCalls: Array<{ sweepKind: string; id: string }> = [];
  const putCalls: Array<{ sweepKind: string; id: string; tip: string; verdict: boolean }> = [];
  return {
    rows,
    retireCalls,
    putCalls,
    get(sweepKind, id, tip) {
      const key = `${sweepKind}:${id}`;
      const row = rows.get(key);
      if (!row || row.tip !== tip) return null;
      return { verdict: row.verdict };
    },
    put(sweepKind, id, tip, verdict) {
      putCalls.push({ sweepKind, id, tip, verdict });
      rows.set(`${sweepKind}:${id}`, { tip, verdict });
    },
    retire(sweepKind, id) {
      retireCalls.push({ sweepKind, id });
      rows.delete(`${sweepKind}:${id}`);
    },
  };
}

describe('sweep-verdict-cache store + numeric cursor', () => {
  it('a tipOf resolving null counts skippedMissingBranch, retires the stored verdict and never calls check', async () => {
    const state = createCachedSweepState();
    const store = fakeStore();
    const items = [{ id: 'a' }];
    const checkCalls: string[] = [];

    const summary = await runCachedSweep(state, {
      sweepKind: 'gone',
      items,
      idOf: (i) => i.id,
      tipOf: () => null,
      check: (i) => {
        checkCalls.push(i.id);
        return true;
      },
      store,
    });

    expect(summary.skippedMissingBranch).toBe(1);
    expect(store.retireCalls).toEqual([{ sweepKind: 'gone', id: 'a' }]);
    expect(checkCalls).toEqual([]);
  });

  it('a numeric cursor records cursorStart/cursorEnd, resumes from the previous sweep and wraps at the end', async () => {
    const state = createCachedSweepState();
    const store = fakeStore();
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    const first = await runCachedSweep(state, {
      sweepKind: 'paged',
      items,
      idOf: (i) => i.id,
      tipOf: (i) => `tip-${i.id}`,
      check: () => true,
      pageSize: 2,
      store,
    });
    expect(first.cursorStart).toBe(0);
    expect(first.cursorEnd).toBe(2);
    expect(state.cursor).toBe(2);

    const second = await runCachedSweep(state, {
      sweepKind: 'paged',
      items,
      idOf: (i) => i.id,
      tipOf: (i) => `tip-${i.id}`,
      check: () => true,
      pageSize: 2,
      store,
    });
    expect(second.cursorStart).toBe(2);
    expect(second.cursorEnd).toBe(3);
    expect(state.cursor).toBe(3);

    const third = await runCachedSweep(state, {
      sweepKind: 'paged',
      items,
      idOf: (i) => i.id,
      tipOf: (i) => `tip-${i.id}`,
      check: () => true,
      pageSize: 2,
      store,
    });
    expect(third.cursorStart).toBe(0); // wrapped
  });

  it('an injected store supplies a hit with an empty in-process cache and receives a put on a miss', async () => {
    const store = fakeStore();
    store.rows.set('durable:x', { tip: 'tip-x', verdict: true });

    const state1 = createCachedSweepState(); // empty state.verdicts — the store must supply the hit
    const summary1 = await runCachedSweep(state1, {
      sweepKind: 'durable',
      items: [{ id: 'x' }],
      idOf: (i) => i.id,
      tipOf: (i) => `tip-${i.id}`,
      check: () => {
        throw new Error('must not run on a store hit');
      },
      store,
    });
    expect(summary1.cachedHits).toBe(1);

    const state2 = createCachedSweepState();
    const summary2 = await runCachedSweep(state2, {
      sweepKind: 'durable',
      items: [{ id: 'y' }],
      idOf: (i) => i.id,
      tipOf: (i) => `tip-${i.id}`,
      check: () => false,
      store,
    });
    expect(summary2.checked).toBe(1);
    expect(store.putCalls).toEqual([{ sweepKind: 'durable', id: 'y', tip: 'tip-y', verdict: false }]);
  });
});
