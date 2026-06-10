import { describe, it, expect } from 'bun:test';
import { shouldReapTmux, isProtectedSession } from '../tmux-reaper.ts';

const H = 60 * 60 * 1000;
const MAX = 7 * 24 * H; // one week

describe('shouldReapTmux', () => {
  it('reaps an OLD session with no live claude and no TUI', () => {
    expect(shouldReapTmux({ ageMs: 8 * 24 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(true);
  });

  it('never reaps a young session (under the idle threshold)', () => {
    expect(shouldReapTmux({ ageMs: 2 * 24 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(false);
  });

  it('never reaps a session with a live claude process (even if old)', () => {
    expect(shouldReapTmux({ ageMs: 100 * H, hasLiveClaude: true, hasTui: false }, MAX)).toBe(false);
  });

  it('never reaps when the TUI is still present (old, claude not detected)', () => {
    expect(shouldReapTmux({ ageMs: 100 * H, hasLiveClaude: false, hasTui: true }, MAX)).toBe(false);
  });

  it('fail-safe: never reaps when liveness is unknown (snapshot unavailable)', () => {
    expect(shouldReapTmux({ ageMs: 1000 * H, hasLiveClaude: null, hasTui: false }, MAX)).toBe(false);
  });

  it('NEVER reaps a protected (planner/steward/supervisor) session, however old/dead', () => {
    expect(shouldReapTmux({ ageMs: 9999 * H, hasLiveClaude: false, hasTui: false, protected: true }, MAX)).toBe(false);
  });

  it('only reaps once past a one-week age', () => {
    expect(shouldReapTmux({ ageMs: 6 * 24 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(false);
    expect(shouldReapTmux({ ageMs: 8 * 24 * H, hasLiveClaude: false, hasTui: false }, MAX)).toBe(true);
  });
});

describe('isProtectedSession', () => {
  it('protects planner/steward/supervisor session slugs', () => {
    expect(isProtectedSession('mc-myproj-planner')).toBe(true);
    expect(isProtectedSession('mc-myproj-steward')).toBe(true);
    expect(isProtectedSession('mc-mermaidcollab-supervisor')).toBe(true);
  });
  it('does not protect worker/pool/other sessions', () => {
    expect(isProtectedSession('mc-myproj-backend1')).toBe(false);
    expect(isProtectedSession('mc-myproj-ui2')).toBe(false);
  });
});
