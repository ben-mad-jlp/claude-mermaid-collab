/**
 * Tests for measure-shared-union-split.ts's fixture — the ON/OFF dispatch simulation the CLI
 * enforces, checked by the ordinary test runner.
 */
import { describe, it, expect } from 'bun:test';
import { runSharedUnionSplitMeasurement } from '../measure-shared-union-split.ts';

describe('measure-shared-union-split fixture', () => {
  it('shared-union-split fixture measures zero ON-run parks and >=3 OFF-run parks', () => {
    const result = runSharedUnionSplitMeasurement();
    expect(result.parksOn).toBe(0);
    expect(result.parksOff).toBeGreaterThanOrEqual(3);
    expect(result.onLeaves.length).toBe(5);
    expect(result.offParkReasons.length).toBe(result.parksOff);
    expect(result.offParkReasons.every((r) => /^epic-base-red/.test(r))).toBe(true);

    const again = runSharedUnionSplitMeasurement();
    expect(again.parksOn).toBe(result.parksOn);
    expect(again.parksOff).toBe(result.parksOff);
    expect(again.onLeaves.length).toBe(result.onLeaves.length);
  });
});
