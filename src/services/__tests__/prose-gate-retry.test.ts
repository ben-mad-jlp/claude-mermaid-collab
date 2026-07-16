import { describe, expect, test } from 'bun:test';
import { proseGateDisposition, synthProseFindings } from '../prose-gate-retry';

describe('proseGateDisposition', () => {
  test('first offense retries', () => {
    expect(proseGateDisposition({ offenseCountSoFar: 1 }).action).toBe('retry');
  });
  test('second offense parks', () => {
    expect(proseGateDisposition({ offenseCountSoFar: 2 }).action).toBe('park');
  });
  test('third offense parks', () => {
    expect(proseGateDisposition({ offenseCountSoFar: 3 }).action).toBe('park');
  });
});

describe('synthProseFindings', () => {
  test('is non-empty', () => {
    expect(synthProseFindings('x').length).toBeGreaterThan(0);
  });
  test('is stable across calls with the same reason', () => {
    expect(synthProseFindings('x')).toBe(synthProseFindings('x'));
  });
  test('embeds the reason', () => {
    expect(synthProseFindings('boom')).toContain('boom');
  });
});
