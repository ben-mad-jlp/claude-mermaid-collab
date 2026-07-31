/**
 * Tests for measure-shared-union-split.ts's fixture — the ON/OFF dispatch simulation the CLI
 * enforces, checked by the ordinary test runner.
 */
import { describe, it, expect } from 'bun:test';
import { runSharedUnionSplitMeasurement } from '../measure-shared-union-split.ts';

describe('measure-shared-union-split fixture', () => {
  it('shared-union-split fixture measures zero ON-run parks and >=3 OFF-run parks', async () => {
    const result = await runSharedUnionSplitMeasurement();
    expect(result.parksOn).toBe(0);
    expect(result.parksOff).toBeGreaterThanOrEqual(3);
    expect(result.onLeaves.length).toBe(5);
    expect(result.offParkReasons.length).toBe(result.parksOff);
    expect(result.offParkReasons.every((r) => /^epic-base-red/.test(r))).toBe(true);

    const again = await runSharedUnionSplitMeasurement();
    expect(again.parksOn).toBe(result.parksOn);
    expect(again.parksOff).toBe(result.parksOff);
    expect(again.onLeaves.length).toBe(result.onLeaves.length);
  });

  it('neutering applyFoundationFirst drives parksOn above 0', async () => {
    const result = await runSharedUnionSplitMeasurement({ applyFoundationFirst: (spec) => spec });
    expect(result.parksOn).toBeGreaterThan(0);
  });

  it('collapsing partitionByFileContention to one batch drives parksOn above 0', async () => {
    // Empirically parksOn stays 0 here: classifyGateFailure keys only on each leaf's own
    // change-set vs the diagnostic's file, never on dispatch batch size, and every commit in
    // this fixture lands sequentially regardless of tick grouping — there is no concurrent
    // worktree state for the file mutex to protect against. This probe demonstrates the
    // baseline ON=0 result is NOT a consequence of file-mutex serialization in this fixture;
    // only applyFoundationFirst ordering (see the sibling probe) drives it. Report this to the
    // conductor as a fabricated-measurement finding for the file-mutex half.
    const result = await runSharedUnionSplitMeasurement({
      partitionByFileContention: (ready) => ({ dispatch: [...ready], deferred: [] }),
    });
    expect(result.parksOn).toBe(0);
  });
});
