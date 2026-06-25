import { describe, test, expect, beforeEach } from 'bun:test';
import { markZenViewed, isZenActivelyViewed, getZenPresence, _resetZenPresence, ZEN_PRESENCE_TTL_MS } from '../zen-presence';

describe('zen-presence', () => {
  beforeEach(() => _resetZenPresence());

  test('not viewed before any heartbeat', () => {
    expect(isZenActivelyViewed(1_000_000)).toBe(false);
    expect(getZenPresence(1_000_000).ageMs).toBeNull();
  });

  test('fresh heartbeat → actively viewed within TTL', () => {
    markZenViewed(1_000_000);
    expect(isZenActivelyViewed(1_000_000)).toBe(true);
    expect(isZenActivelyViewed(1_000_000 + ZEN_PRESENCE_TTL_MS)).toBe(true); // boundary inclusive
  });

  test('stale heartbeat past TTL → not viewed', () => {
    markZenViewed(1_000_000);
    expect(isZenActivelyViewed(1_000_000 + ZEN_PRESENCE_TTL_MS + 1)).toBe(false);
  });

  test('snapshot reports age + active', () => {
    markZenViewed(1_000_000);
    const snap = getZenPresence(1_000_000 + 5_000);
    expect(snap.ageMs).toBe(5_000);
    expect(snap.active).toBe(true);
  });
});
