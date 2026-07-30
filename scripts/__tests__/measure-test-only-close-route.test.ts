/**
 * Tests for measure-test-only-close-route.ts's fixture — the same five-tick
 * runConductorPass drive the CLI enforces, checked by the ordinary test runner.
 */
import { describe, it, expect } from 'bun:test';
import { runMeasurementFixture } from '../measure-test-only-close-route.ts';

describe('measure-test-only-close-route fixture', () => {
  it('after 5 ticks yields one claimable close-out leaf, one current-verdict serve-cap card, and zero duplicates', async () => {
    const result = await runMeasurementFixture();
    expect(result.closeOutLeaves.length).toBe(1);
    expect(result.claimableResult).toBe(true);
    expect(result.openServeCapCards.length).toBe(1);
    expect(result.openServeCapCards[0].questionText).toContain(result.verifiedAtShaII);
    expect(result.duplicateCardCount).toBe(0);
    expect(result.duplicateLeafGroups).toBe(0);
  });
});
