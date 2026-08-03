import { test, expect } from 'bun:test';
import { savingBound, percentiles, isMeasurableReviewRow } from '../measure-gate-review-overlap';

test('savingBound picks the gate duration when gate < review', () => {
  const result = savingBound(100, 200);
  expect(result).toBe(100);
});

test('savingBound picks the review duration when review < gate', () => {
  const result = savingBound(200, 100);
  expect(result).toBe(100);
});

test('savingBound returns the shared value when gate equals review', () => {
  const result = savingBound(150, 150);
  expect(result).toBe(150);
});

test('isMeasurableReviewRow excludes rows with null or zero durationMs', () => {
  const nullRow = { nodeKind: 'review', durationMs: null };
  const zeroRow = { nodeKind: 'review', durationMs: 0 };
  const validRow = { nodeKind: 'review', durationMs: 5 };
  const notReviewRow = { nodeKind: 'build', durationMs: 5 };

  expect(isMeasurableReviewRow(nullRow)).toBe(false);
  expect(isMeasurableReviewRow(zeroRow)).toBe(false);
  expect(isMeasurableReviewRow(validRow)).toBe(true);
  expect(isMeasurableReviewRow(notReviewRow)).toBe(false);
});

test('percentiles computes p50 correctly with linear interpolation', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = percentiles(xs, [50]);

  // For p50 with 10 elements, rank = 0.5 * (10 - 1) = 4.5
  // Interpolate between xs[4]=5 and xs[5]=6
  // result = 5 * (1 - 0.5) + 6 * 0.5 = 5.5
  expect(result[0]).toBe(5.5);
});

test('percentiles handles multiple percentiles', () => {
  const xs = [10, 20, 30, 40, 50];
  const result = percentiles(xs, [25, 50, 75]);

  expect(result.length).toBe(3);
  // All values should be within the range
  expect(result[0]).toBeGreaterThanOrEqual(10);
  expect(result[0]).toBeLessThanOrEqual(50);
  expect(result[1]).toBeGreaterThanOrEqual(10);
  expect(result[1]).toBeLessThanOrEqual(50);
  expect(result[2]).toBeGreaterThanOrEqual(10);
  expect(result[2]).toBeLessThanOrEqual(50);
});

test('percentiles returns NaN for empty input', () => {
  const result = percentiles([], [50]);
  expect(Number.isNaN(result[0])).toBe(true);
});

test('percentiles with single element', () => {
  const result = percentiles([42], [10, 50, 90]);
  // With one element, all percentiles should return that element
  expect(result[0]).toBe(42);
  expect(result[1]).toBe(42);
  expect(result[2]).toBe(42);
});
