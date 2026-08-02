import { describe, it, expect } from 'bun:test';
import { locRatchetVerdict } from '../loc-ratchet';

describe('loc-ratchet', () => {
  it('growing past base fails the ratchet', () => {
    const base = 1000;
    const verdict = locRatchetVerdict({ current: base + 1, base });
    expect(verdict.ok).toBe(false);
  });

  it('staying at or under base passes the ratchet', () => {
    const base = 1000;
    const verdictAtBase = locRatchetVerdict({ current: base, base });
    expect(verdictAtBase.ok).toBe(true);

    const verdictUnderBase = locRatchetVerdict({ current: base - 1, base });
    expect(verdictUnderBase.ok).toBe(true);
  });
});
