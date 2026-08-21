import { describe, it, expect } from 'bun:test';
import { createCachedSweepState, runCachedSweep } from '../sweep-verdict-cache';
import type { VerdictStore } from '../sweep-verdict-cache';

function makeStore(): VerdictStore {
  const map = new Map<string, { verdict: boolean }>();
  const key = (sweepKind: string, id: string, tip: string) => `${sweepKind}:${id}:${tip}`;
  return {
    get(sweepKind, id, tip) {
      return map.get(key(sweepKind, id, tip)) ?? null;
    },
    put(sweepKind, id, tip, verdict) {
      map.set(key(sweepKind, id, tip), { verdict });
    },
    retire(sweepKind, id) {
      for (const k of [...map.keys()]) {
        if (k.startsWith(`${sweepKind}:${id}:`)) map.delete(k);
      }
    },
  };
}

describe('sweep-verdict-cache', () => {
  it('skips the check callback on a second sweep with an unchanged branchTips sha', async () => {
    const state = createCachedSweepState();
    let checkCalls = 0;
    const check = () => {
      checkCalls++;
    };
    const branchTips = 'abc123';

    await runCachedSweep(state, { branchTips, check });
    expect(state.skippedUnchanged).toBe(0);

    await runCachedSweep(state, { branchTips, check });
    expect(state.skippedUnchanged).toBe(1);
    expect(checkCalls).toBe(1);
  });

  it('reuses cached verdicts across two sweeps of the same items at an unchanged tip', async () => {
    const state = createCachedSweepState();
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const store = makeStore();
    const idOf = (s: string) => s;
    const tipOf = () => 'sha-const';
    const check = () => true;

    await runCachedSweep(state, { sweepKind: 'test-sweep', items, idOf, tipOf, check, store });

    const second = await runCachedSweep(state, {
      sweepKind: 'test-sweep',
      items,
      idOf,
      tipOf,
      check,
      store,
    });

    expect(second.skippedUnchanged).toBe(30);
    expect(second.checked).toBe(0);
  });

  it('pages through items using the numeric cursor persisted on state', async () => {
    const state = createCachedSweepState();
    const items = Array.from({ length: 60 }, (_, i) => `item-${i}`);
    const store = makeStore();
    const idOf = (s: string) => s;
    const tipOf = () => 'sha-const';
    const check = () => true;

    const first = await runCachedSweep(state, {
      sweepKind: 'paged-sweep',
      items,
      idOf,
      tipOf,
      check,
      pageSize: 30,
      store,
    });
    expect(first.cursorStart).toBe(0);
    expect(first.cursorEnd).toBe(30);

    const second = await runCachedSweep(state, {
      sweepKind: 'paged-sweep',
      items,
      idOf,
      tipOf,
      check,
      pageSize: 30,
      store,
    });
    expect(second.cursorStart).toBe(30);
    expect(second.cursorEnd).toBe(60);
  });

  it('counts an item whose tipOf resolves null toward skippedMissingBranch', async () => {
    const state = createCachedSweepState();
    const items = ['gone-item'];
    const store = makeStore();

    const summary = await runCachedSweep(state, {
      sweepKind: 'missing-branch-sweep',
      items,
      idOf: (s) => s,
      tipOf: () => null,
      check: () => true,
      store,
    });

    expect(summary.skippedMissingBranch).toBe(1);
  });
});
