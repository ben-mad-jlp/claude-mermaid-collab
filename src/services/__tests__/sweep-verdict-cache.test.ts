import { describe, it, expect } from 'bun:test';
import { createCachedSweepState, runCachedSweep } from '../sweep-verdict-cache';

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
});
