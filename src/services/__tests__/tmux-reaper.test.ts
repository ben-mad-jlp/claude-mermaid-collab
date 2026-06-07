import { describe, it, expect } from 'bun:test';
import { shouldReapTmux } from '../tmux-reaper.ts';

const H = 60 * 60 * 1000;
const MAX = 6 * H;

describe('shouldReapTmux', () => {
  it('reaps an OLD session with no live claude and no TUI', () => {
    expect(shouldReapTmux({ ageMs: 7 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(true);
  });

  it('never reaps a young session (under the idle threshold)', () => {
    expect(shouldReapTmux({ ageMs: 1 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(false);
  });

  it('never reaps a session with a live claude process (even if old)', () => {
    expect(shouldReapTmux({ ageMs: 100 * H, hasLiveClaude: true, hasTui: false }, MAX)).toBe(false);
  });

  it('never reaps when the TUI is still present (old, claude not detected)', () => {
    expect(shouldReapTmux({ ageMs: 100 * H, hasLiveClaude: false, hasTui: true }, MAX)).toBe(false);
  });

  it('fail-safe: never reaps when liveness is unknown (snapshot unavailable)', () => {
    expect(shouldReapTmux({ ageMs: 100 * H, hasLiveClaude: null, hasTui: false }, MAX)).toBe(false);
  });
});
