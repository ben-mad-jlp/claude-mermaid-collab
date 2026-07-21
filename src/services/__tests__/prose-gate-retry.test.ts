import { describe, expect, test } from 'bun:test';
import { proseGateDisposition, synthProseFindings } from '../prose-gate-retry';

describe('proseGateDisposition (per-gate-kind counting)', () => {
  test('first offense of a kind retries', () => {
    expect(proseGateDisposition({ offenseCountForKind: 1, totalOffenseCountSoFar: 1 }).action).toBe('retry');
  });
  test('second offense of the SAME kind parks', () => {
    expect(proseGateDisposition({ offenseCountForKind: 2, totalOffenseCountSoFar: 2 }).action).toBe('park');
  });
  test('third offense of the same kind parks', () => {
    expect(proseGateDisposition({ offenseCountForKind: 3, totalOffenseCountSoFar: 3 }).action).toBe('park');
  });
  test('two DIFFERENT kinds each retry once (2 total, neither kind repeats)', () => {
    expect(proseGateDisposition({ offenseCountForKind: 1, totalOffenseCountSoFar: 1 }).action).toBe('retry');
    expect(proseGateDisposition({ offenseCountForKind: 1, totalOffenseCountSoFar: 2 }).action).toBe('retry');
  });
  test('a THIRD distinct kind parks once the overall ceiling (2 total retries) is exceeded', () => {
    expect(proseGateDisposition({ offenseCountForKind: 1, totalOffenseCountSoFar: 3 }).action).toBe('park');
  });
  test('overall ceiling parks even for a brand-new kind at total=3+ regardless of per-kind count', () => {
    expect(proseGateDisposition({ offenseCountForKind: 1, totalOffenseCountSoFar: 4 }).action).toBe('park');
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
