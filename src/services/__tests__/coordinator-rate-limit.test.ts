import { describe, it, expect } from 'bun:test';
import { detectRateLimit } from '../coordinator-live';

describe('detectRateLimit', () => {
  it('fires on the transient server throttle message', () => {
    expect(
      detectRateLimit('API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited'),
    ).toBe(true);
  });

  it('fires on a bare "Rate limited" line', () => {
    expect(detectRateLimit('... some output\n  ⎿  Rate limited — retrying\n')).toBe(true);
  });

  it('does NOT fire on the user usage cap (human-gated)', () => {
    expect(detectRateLimit("Claude usage limit reached. Your limit will reset at 5pm.")).toBe(false);
    expect(detectRateLimit("You've reached your usage limit for now.")).toBe(false);
  });

  it('does not fire on ordinary working output', () => {
    expect(detectRateLimit('✻ Zesting… (26s · ↓ 1.1k tokens)')).toBe(false);
    expect(detectRateLimit('Editing src/foo.ts — done')).toBe(false);
  });

  it('treats the transient message as recoverable even though it mentions "usage limit"', () => {
    // "(not your usage limit)" must NOT be misread as the cap-reached wording.
    const transient = 'temporarily limiting requests (not your usage limit) · Rate limited';
    expect(detectRateLimit(transient)).toBe(true);
  });
});
